#!/bin/bash
# ==============================================================================
# dev-ephemeral-deploy.sh — Ephemeral deployment for changed DEV services
# ==============================================================================
set -eo pipefail

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
CLUSTER_NAME="${CLUSTER_NAME:-nt548-cluster}"
IMAGE_TAG="${IMAGE_TAG:-}"
CHANGED_ENV="${1:-changed_components.env}"

if [ -z "$IMAGE_TAG" ]; then
    echo "ERROR: IMAGE_TAG must be the source commit SHA. Mutable fallback tags are forbidden."
    exit 1
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Load changed components if present
if [ -f "$CHANGED_ENV" ]; then
    # shellcheck source=/dev/null
    source "$CHANGED_ENV"
elif [ -f "build_metadata.json" ]; then
    # Try reading from build_metadata.json
    export FRONTEND_CHANGED=$(python3 -c "import json; print(str(json.load(open('build_metadata.json')).get('components', {}).get('frontend', True)).lower())" 2>/dev/null || echo "true")
    export USER_CHANGED=$(python3 -c "import json; print(str(json.load(open('build_metadata.json')).get('components', {}).get('user', True)).lower())" 2>/dev/null || echo "true")
    export PRODUCT_CHANGED=$(python3 -c "import json; print(str(json.load(open('build_metadata.json')).get('components', {}).get('product', True)).lower())" 2>/dev/null || echo "true")
    export ORDER_CHANGED=$(python3 -c "import json; print(str(json.load(open('build_metadata.json')).get('components', {}).get('order', True)).lower())" 2>/dev/null || echo "true")
else
    FRONTEND_CHANGED=true
    USER_CHANGED=true
    PRODUCT_CHANGED=true
    ORDER_CHANGED=true
fi

echo "=================================================="
echo "🚀 DEPLOYING DEV EPHEMERAL STACK"
echo "Region    : $AWS_REGION"
echo "Cluster   : $CLUSTER_NAME"
echo "Image Tag : $IMAGE_TAG"
echo "Account   : $ACCOUNT_ID"
echo "Changed Services:"
echo "   frontend: ${FRONTEND_CHANGED:-true}"
echo "   user    : ${USER_CHANGED:-true}"
echo "   product : ${PRODUCT_CHANGED:-true}"
echo "   order   : ${ORDER_CHANGED:-true}"
echo "=================================================="

# Lookup Shared Resources
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Project,Values=NT548" --query "Vpcs[0].VpcId" --region "$AWS_REGION" --output text)
SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Type,Values=Public" --query "Subnets[*].SubnetId" --region "$AWS_REGION" --output text | tr '\t' ',')
ECS_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=nt548-ecs-tasks-sg" --query "SecurityGroups[0].GroupId" --region "$AWS_REGION" --output text)
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn $(aws elbv2 describe-load-balancers --names nt548-shared-alb --region "$AWS_REGION" --query "LoadBalancers[0].LoadBalancerArn" --output text) --region "$AWS_REGION" --query "Listeners[?Port==\`80\`].ListenerArn" --output text)
EXEC_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/nt548-ecs-task-execution-role"

echo "VPC: $VPC_ID"
echo "Subnets: $SUBNETS"
echo "Listener: $LISTENER_ARN"

# 1. Create DEV Target Groups
create_tg() {
    local name=$1
    local port=$2
    local path=$3

    local existing=$(aws elbv2 describe-target-groups --names "$name" --region "$AWS_REGION" --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null || true)
    if [ -n "$existing" ] && [ "$existing" != "None" ]; then
        echo "$existing"
        return
    fi

    local arn=$(aws elbv2 create-target-group \
        --name "$name" \
        --protocol HTTP \
        --port "$port" \
        --vpc-id "$VPC_ID" \
        --target-type ip \
        --health-check-protocol HTTP \
        --health-check-path "$path" \
        --health-check-interval-seconds 10 \
        --healthy-threshold-count 2 \
        --unhealthy-threshold-count 3 \
        --region "$AWS_REGION" \
        --query "TargetGroups[0].TargetGroupArn" --output text)

    aws elbv2 modify-target-group-attributes \
        --target-group-arn "$arn" \
        --attributes Key=deregistration_delay.timeout_seconds,Value=5 \
        --region "$AWS_REGION" >/dev/null 2>&1 || true

    echo "$arn"
}

# 2. Create DEV ALB Cookie Routing Rules
create_rule() {
    local priority=$1
    local path_pattern=$2
    local tg_arn=$3

    # Delete existing rule at this priority if exists
    local rule_arn=$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" --region "$AWS_REGION" --query "Rules[?Priority==\`$priority\`].RuleArn" --output text 2>/dev/null || true)
    if [ -n "$rule_arn" ] && [ "$rule_arn" != "None" ]; then
        aws elbv2 delete-rule --rule-arn "$rule_arn" --region "$AWS_REGION" 2>/dev/null || true
    fi

    if [ -n "$path_pattern" ]; then
        aws elbv2 create-rule \
            --listener-arn "$LISTENER_ARN" \
            --priority "$priority" \
            --conditions '[
                {"Field":"http-header","HttpHeaderConfig":{"HttpHeaderName":"Cookie","Values":["*nt548-test=true*"]}},
                {"Field":"path-pattern","PathPatternConfig":{"Values":["'$path_pattern'"]}}
            ]' \
            --actions Type=forward,TargetGroupArn="$tg_arn" \
            --region "$AWS_REGION" >/dev/null
    else
        aws elbv2 create-rule \
            --listener-arn "$LISTENER_ARN" \
            --priority "$priority" \
            --conditions '[
                {"Field":"http-header","HttpHeaderConfig":{"HttpHeaderName":"Cookie","Values":["*nt548-test=true*"]}}
            ]' \
            --actions Type=forward,TargetGroupArn="$tg_arn" \
            --region "$AWS_REGION" >/dev/null
    fi
}

# 3. Register Task Definitions and Deploy Services
deploy_service() {
    local name=$1
    local port=$2
    local tg_arn=$3
    local repo="nt548-dev-$name"
    local image="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$repo:$IMAGE_TAG"
    local service_name="nt548-dev-$name"

    local service_status
    service_status=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --region "$AWS_REGION" \
        --query "services[0].status" \
        --output text 2>/dev/null || true)

    if [ "$service_status" = "DRAINING" ]; then
        echo "Waiting for $service_name to become reusable..."
        for attempt in $(seq 1 60); do
            service_status=$(aws ecs describe-services \
                --cluster "$CLUSTER_NAME" \
                --services "$service_name" \
                --region "$AWS_REGION" \
                --query "services[0].status" \
                --output text 2>/dev/null || true)
            if [ -z "$service_status" ] || [ "$service_status" = "None" ] || [ "$service_status" = "INACTIVE" ]; then
                break
            fi
            echo "Service $service_name is $service_status (attempt $attempt/60)"
            sleep 5
        done

        if [ "$service_status" = "DRAINING" ]; then
            echo "ERROR: $service_name remained DRAINING for 5 minutes"
            exit 1
        fi
    fi

    echo "Registering Task Definition for $name..."
    local taskdef=$(aws ecs register-task-definition \
        --family "nt548-dev-$name" \
        --network-mode awsvpc \
        --requires-compatibilities FARGATE \
        --cpu "256" \
        --memory "512" \
        --execution-role-arn "$EXEC_ROLE_ARN" \
        --container-definitions '[{
            "name": "'$name'",
            "image": "'$image'",
            "essential": true,
            "portMappings": [{"containerPort": '$port', "protocol": "tcp"}],
            "environment": [
                {"name": "ENVIRONMENT", "value": "dev"},
                {"name": "NODE_ENV", "value": "production"},
                {"name": "JWT_SECRET", "value": "nt548-dev-secret-key-ephemeral"},
                {"name": "PORT", "value": "'$port'"},
                {"name": "USER_SERVICE_HOST", "value": "localhost"},
                {"name": "USER_SERVICE_PORT", "value": "5001"},
                {"name": "PRODUCT_SERVICE_HOST", "value": "localhost"},
                {"name": "PRODUCT_SERVICE_PORT", "value": "5002"},
                {"name": "ORDER_SERVICE_HOST", "value": "localhost"},
                {"name": "ORDER_SERVICE_PORT", "value": "5003"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "/nt548/dev/'$name'",
                    "awslogs-region": "'$AWS_REGION'",
                    "awslogs-stream-prefix": "dev"
                }
            }
        }]' \
        --region "$AWS_REGION" --query "taskDefinition.taskDefinitionArn" --output text)

    if [ "$service_status" = "ACTIVE" ]; then
        echo "Updating existing DEV service $name..."
        aws ecs update-service \
            --cluster "$CLUSTER_NAME" \
            --service "$service_name" \
            --task-definition "$taskdef" \
            --desired-count 1 \
            --region "$AWS_REGION" >/dev/null
    else
        echo "Creating new DEV service $name..."
        aws ecs create-service \
            --cluster "$CLUSTER_NAME" \
            --service-name "$service_name" \
            --task-definition "$taskdef" \
            --desired-count 1 \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
            --load-balancers "targetGroupArn=$tg_arn,containerName=$name,containerPort=$port" \
            --region "$AWS_REGION" >/dev/null
    fi
}

SERVICES_TO_WAIT=()

# Conditionally deploy only changed services
if [ "${FRONTEND_CHANGED:-false}" = "true" ]; then
    echo "Configuring Ephemeral DEV frontend..."
    TG_FE_ARN=$(create_tg "nt548-dev-tg-fe" 80 "/health")
    create_rule 13 "" "$TG_FE_ARN"
    deploy_service "frontend" 80 "$TG_FE_ARN"
    SERVICES_TO_WAIT+=("nt548-dev-frontend")
else
    echo "⏭️ [SKIP] frontend unchanged, skipping ephemeral deployment"
fi

if [ "${USER_CHANGED:-false}" = "true" ]; then
    echo "Configuring Ephemeral DEV user service..."
    TG_USER_ARN=$(create_tg "nt548-dev-tg-user" 5001 "/health")
    create_rule 10 "/api/users*" "$TG_USER_ARN"
    deploy_service "user" 5001 "$TG_USER_ARN"
    SERVICES_TO_WAIT+=("nt548-dev-user")
else
    echo "⏭️ [SKIP] user service unchanged, skipping ephemeral deployment"
fi

if [ "${PRODUCT_CHANGED:-false}" = "true" ]; then
    echo "Configuring Ephemeral DEV product service..."
    TG_PROD_ARN=$(create_tg "nt548-dev-tg-product" 5002 "/health")
    create_rule 11 "/api/products*" "$TG_PROD_ARN"
    deploy_service "product" 5002 "$TG_PROD_ARN"
    SERVICES_TO_WAIT+=("nt548-dev-product")
else
    echo "⏭️ [SKIP] product service unchanged, skipping ephemeral deployment"
fi

if [ "${ORDER_CHANGED:-false}" = "true" ]; then
    echo "Configuring Ephemeral DEV order service..."
    TG_ORDER_ARN=$(create_tg "nt548-dev-tg-order" 5003 "/health")
    create_rule 12 "/api/orders*" "$TG_ORDER_ARN"
    deploy_service "order" 5003 "$TG_ORDER_ARN"
    SERVICES_TO_WAIT+=("nt548-dev-order")
else
    echo "⏭️ [SKIP] order service unchanged, skipping ephemeral deployment"
fi

if [ ${#SERVICES_TO_WAIT[@]} -gt 0 ]; then
    echo "Waiting for deployed DEV ECS services to reach stable state: ${SERVICES_TO_WAIT[*]}..."
    aws ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "${SERVICES_TO_WAIT[@]}" \
        --region "$AWS_REGION"
    echo "✅ Ephemeral DEV deployment is stable and ready for smoke tests."
else
    echo "ℹ️ No ephemeral services deployed (all services unchanged)."
fi
