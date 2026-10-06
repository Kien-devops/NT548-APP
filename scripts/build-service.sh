#!/bin/bash
# ==============================================================================
# build-service.sh — Reusable Docker image builder for NT548-APP microservices
#
# Usage: ./scripts/build-service.sh <service> <image-tag> [env]
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

case "$SERVICE" in
    frontend)
        DOCKER_DIR="./frontend"
        ;;
    user)
        DOCKER_DIR="./be-user-service"
        ;;
    product)
        DOCKER_DIR="./be-product-service"
        ;;
    order)
        DOCKER_DIR="./be-order-service"
        ;;
    *)
        echo "❌ Unknown service for Docker build: $SERVICE"
        exit 1
        ;;
esac

echo "=================================================="
echo "🔨 [BUILD] Building Docker image for: $SERVICE"
echo "   Directory : $DOCKER_DIR"
echo "   Target Tag: $IMAGE_URI"
echo "=================================================="

docker build -t "$IMAGE_URI" "$DOCKER_DIR"

echo "✅ [BUILD] Successfully built $IMAGE_URI"
