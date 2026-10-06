#!/bin/bash
# ==============================================================================
# push-image.sh — Reusable ECR image pusher for NT548-APP microservices
#
# Usage: ./scripts/push-image.sh <service> <image-tag> [env]
# ==============================================================================
set -euo pipefail

SERVICE="${1:-}"
IMAGE_TAG="${2:-}"
ENVIRONMENT="${3:-${ENVIRONMENT:-prod}}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"

if [ -z "$SERVICE" ] || [ -z "$IMAGE_TAG" ]; then
    echo "Usage: $0 <frontend|user|product|order> <image-tag> [env]"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO_NAME="nt548-${ENVIRONMENT}-${SERVICE}"
IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

echo "=================================================="
echo "📤 [PUSH] Pushing image to ECR: $SERVICE"
echo "   Repository: $REPO_NAME"
echo "   Tag       : $IMAGE_TAG"
echo "=================================================="

# Check if image with this tag already exists (prevents failure on ECR immutable repositories)
if aws ecr describe-images --repository-name "$REPO_NAME" --image-ids imageTag="$IMAGE_TAG" --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "ℹ️ [PUSH] Image $REPO_NAME:$IMAGE_TAG already exists in ECR. Skipping push."
else
    docker push "$IMAGE_URI"
    echo "✅ [PUSH] Pushed $IMAGE_URI successfully."
fi
