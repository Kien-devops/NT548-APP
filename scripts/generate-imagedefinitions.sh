#!/bin/bash
# ==============================================================================
# generate-imagedefinitions.sh — Generates ECS image definition artifacts
#
# Generates imagedefinitions-<service>.json for each microservice.
# - Changed services receive the new image URI with $IMAGE_TAG.
# - Unchanged services retain their currently deployed image URI in ECS,
#   ensuring idempotent rolling deployments without unnecessary task rebuilds.
#
# Usage: ./scripts/generate-imagedefinitions.sh <account-id> <region> <image-tag> [changed_components_env]
# ==============================================================================
set -euo pipefail

ACCOUNT_ID="$1"
AWS_REGION="${2:-ap-southeast-1}"
IMAGE_TAG="$3"
CHANGED_ENV="${4:-changed_components.env}"
CLUSTER_NAME="${CLUSTER_NAME:-nt548-cluster}"

if [ -z "$ACCOUNT_ID" ] || [ -z "$IMAGE_TAG" ]; then
    echo "Usage: $0 <account-id> <region> <image-tag> [changed_components_env]"
    exit 1
fi

# Load changed components if present
if [ -f "$CHANGED_ENV" ]; then
    # shellcheck source=/dev/null
    source "$CHANGED_ENV"
else
    FRONTEND_CHANGED=true
    USER_CHANGED=true
    PRODUCT_CHANGED=true
    ORDER_CHANGED=true
fi

echo "=================================================="
echo "📝 [IMAGEDEF] Generating ECS Image Definitions"
echo "Account ID: $ACCOUNT_ID"
echo "Region    : $AWS_REGION"
echo "Image Tag : $IMAGE_TAG"
echo "=================================================="

for service in frontend user product order; do
    file="imagedefinitions-${service}.json"
    is_changed=true

    case "$service" in
        frontend) is_changed="${FRONTEND_CHANGED:-true}" ;;
        user)     is_changed="${USER_CHANGED:-true}" ;;
        product)  is_changed="${PRODUCT_CHANGED:-true}" ;;
        order)    is_changed="${ORDER_CHANGED:-true}" ;;
    esac

    target_image=""
    if [ "$is_changed" = "true" ]; then
        target_image="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/nt548-prod-${service}:${IMAGE_TAG}"
        echo "   [IMAGEDEF] $service: CHANGED -> using new image tag $IMAGE_TAG"
    else
        # Query ECS for current deployed image URI
        current_taskdef=$(aws ecs describe-services \
            --cluster "$CLUSTER_NAME" \
            --services "nt548-prod-${service}" \
            --region "$AWS_REGION" \
            --query "services[0].taskDefinition" \
            --output text 2>/dev/null || true)

        if [ -n "$current_taskdef" ] && [ "$current_taskdef" != "None" ]; then
            current_image=$(aws ecs describe-task-definition \
                --task-definition "$current_taskdef" \
                --region "$AWS_REGION" \
                --query "taskDefinition.containerDefinitions[?name=='${service}'].image | [0]" \
                --output text 2>/dev/null || true)

            if [ -n "$current_image" ] && [ "$current_image" != "None" ]; then
                target_image="$current_image"
                echo "   [IMAGEDEF] $service: UNCHANGED -> retaining deployed image: $current_image"
            fi
        fi

        # Fallback to current commit tag if unable to query ECS
        if [ -z "$target_image" ]; then
            target_image="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/nt548-prod-${service}:${IMAGE_TAG}"
            echo "   [IMAGEDEF] $service: UNCHANGED (no active ECS task found) -> fallback to $IMAGE_TAG"
        fi
    fi

    printf '[{"name":"%s","imageUri":"%s"}]\n' "$service" "$target_image" > "$file"
    echo "   [IMAGEDEF] Generated $file:"
    cat "$file"
done

echo "✅ [IMAGEDEF] All ECS image definitions generated successfully."
