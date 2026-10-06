#!/bin/bash
set +e # Don't exit on error during cleanup

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
CLUSTER_NAME="${CLUSTER_NAME:-nt548-cluster}"
CLEANUP_FAILED=0


echo "=================================================="
echo "🧹 STARTING DEV EPHEMERAL CLEANUP"
echo "Region : $AWS_REGION"
echo "Cluster: $CLUSTER_NAME"
echo "=================================================="

# 1. Delete DEV ALB Rules (Priorities 10, 11, 12, 13) FIRST to disconnect incoming traffic
ALB_ARN=$(aws elbv2 describe-load-balancers --names nt548-shared-alb --region "$AWS_REGION" --query "LoadBalancers[0].LoadBalancerArn" --output text 2>/dev/null || true)
if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
    LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --region "$AWS_REGION" --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text 2>/dev/null || true)
    if [ -n "$LISTENER_ARN" ] && [ "$LISTENER_ARN" != "None" ]; then
        for prio in 10 11 12 13; do
            rule_arn=$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" --region "$AWS_REGION" --query "Rules[?Priority=='$prio'].RuleArn | [0]" --output text 2>/dev/null || true)
            if [ -n "$rule_arn" ] && [ "$rule_arn" != "None" ]; then
                echo "Deleting DEV ALB rule priority $prio ($rule_arn)..."
                aws elbv2 delete-rule --rule-arn "$rule_arn" --region "$AWS_REGION" 2>/dev/null || true
            fi
        done
    fi
fi

# 2. Delete ECS DEV Services
SERVICES=("nt548-dev-frontend" "nt548-dev-user" "nt548-dev-product" "nt548-dev-order")
for svc in "${SERVICES[@]}"; do
    echo "Scale down & delete ECS service: $svc..."
    aws ecs update-service --cluster "$CLUSTER_NAME" --service "$svc" --desired-count 0 --region "$AWS_REGION" 2>/dev/null || true
    aws ecs delete-service --cluster "$CLUSTER_NAME" --service "$svc" --force --region "$AWS_REGION" 2>/dev/null || true
done

# 3. Wait until deleted services finish draining (checked concurrently)
echo "Waiting for ECS services to finish draining..."
for attempt in $(seq 1 15); do
    draining_count=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "${SERVICES[@]}" \
        --region "$AWS_REGION" \
        --query "length(services[?status=='DRAINING'])" \
        --output text 2>/dev/null || echo "0")
    if [ "$draining_count" = "0" ] || [ -z "$draining_count" ]; then
        echo "All services cleared from DRAINING."
        break
    fi
    echo "Draining services remaining: $draining_count (attempt $attempt/15)..."
    sleep 3
done

# 4. Delete target groups with bounded retries
TARGET_GROUPS=("nt548-dev-tg-fe" "nt548-dev-tg-user" "nt548-dev-tg-product" "nt548-dev-tg-order")
for tg in "${TARGET_GROUPS[@]}"; do
    tg_arn=$(aws elbv2 describe-target-groups --names "$tg" --region "$AWS_REGION" --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null || true)
    if [ -n "$tg_arn" ] && [ "$tg_arn" != "None" ]; then
        echo "Deleting DEV target group: $tg ($tg_arn)..."
        deleted=0
        for attempt in $(seq 1 15); do
            if aws elbv2 delete-target-group --target-group-arn "$tg_arn" --region "$AWS_REGION" 2>/dev/null; then
                deleted=1
                echo "Target group $tg deleted successfully."
                break
            fi
            echo "Target group $tg is still in use (attempt $attempt/15)..."
            sleep 3
        done
        if [ "$deleted" -ne 1 ]; then
            echo "ERROR: Failed to delete target group $tg"
            CLEANUP_FAILED=1
        fi
    fi
done

echo "=================================================="
echo "✨ DEV EPHEMERAL CLEANUP COMPLETED!"
echo "Shared ALB, VPC, ECR, CodePipeline, PROD ECS remain untouched."
echo "=================================================="

exit "$CLEANUP_FAILED"
