#!/bin/bash
set -eo pipefail

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
IMAGE_TAG="$1"

if [ -z "$IMAGE_TAG" ]; then
    echo "Usage: $0 <image-tag>"
    exit 1
fi

echo "=================================================="
echo "🛡️ ECR VULNERABILITY SCAN SECURITY GATE"
echo "Region   : $AWS_REGION"
echo "Image Tag: $IMAGE_TAG"
echo "=================================================="

REPOS=("nt548-prod-user" "nt548-prod-product" "nt548-prod-order" "nt548-prod-frontend")
printf '[\n' > ecr-scan-summary.json
first=true

for repo in "${REPOS[@]}"; do
    echo "Checking scan findings for $repo:$IMAGE_TAG..."
    STATUS="IN_PROGRESS"
    for i in {1..60}; do
        STATUS=$(aws ecr describe-image-scan-findings --repository-name "$repo" --image-id imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageScanStatus.status" --output text 2>/dev/null || true)
        if [ "$STATUS" = "COMPLETE" ]; then
            break
        fi
        STATUS=${STATUS:-IN_PROGRESS}
        echo "Scan status: $STATUS. Waiting 5s (attempt $i/60)..."
        sleep 5
    done

    if [ "$STATUS" != "COMPLETE" ]; then
        echo "❌ SECURITY GATE FAILED CLOSED: scan for $repo:$IMAGE_TAG did not complete successfully (status=$STATUS)."
        exit 1
    fi

    CRITICAL=$(aws ecr describe-image-scan-findings --repository-name "$repo" --image-id imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageScanFindings.findingSeverityCounts.CRITICAL" --output text)
    HIGH=$(aws ecr describe-image-scan-findings --repository-name "$repo" --image-id imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageScanFindings.findingSeverityCounts.HIGH" --output text)
    DIGEST=$(aws ecr describe-images --repository-name "$repo" --image-ids imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageDetails[0].imageDigest" --output text)

    [ "$CRITICAL" = "None" ] && CRITICAL=0
    [ "$HIGH" = "None" ] && HIGH=0

    if [ "$first" = false ]; then printf ',\n' >> ecr-scan-summary.json; fi
    first=false
    printf '  {"repository":"%s","tag":"%s","digest":"%s","critical":%s,"high":%s}' \
        "$repo" "$IMAGE_TAG" "$DIGEST" "$CRITICAL" "$HIGH" >> ecr-scan-summary.json

    echo "📊 $repo scan findings: CRITICAL=$CRITICAL, HIGH=$HIGH"
    if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
        echo "❌ SECURITY GATE FAILED: $repo has $CRITICAL CRITICAL and $HIGH HIGH findings!"
        exit 1
    fi
done

printf '\n]\n' >> ecr-scan-summary.json

echo "✅ ECR Image Security Gate PASSED: 0 CRITICAL and 0 HIGH findings across all images."
