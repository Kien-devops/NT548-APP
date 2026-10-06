#!/bin/bash
# ==============================================================================
# check-service-scan.sh — Reusable ECR vulnerability scanner for NT548-APP
#
# Usage: ./scripts/check-service-scan.sh <service> <image-tag> [env]
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

REPO_NAME="nt548-${ENVIRONMENT}-${SERVICE}"

echo "=================================================="
echo "🛡️ [SECURITY-GATE] Checking ECR scan for: $SERVICE"
echo "   Repository: $REPO_NAME"
echo "   Tag       : $IMAGE_TAG"
echo "=================================================="

STATUS="IN_PROGRESS"
for i in {1..60}; do
    STATUS=$(aws ecr describe-image-scan-findings --repository-name "$REPO_NAME" --image-id imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageScanStatus.status" --output text 2>/dev/null || true)
    if [ "$STATUS" = "COMPLETE" ]; then
        break
    fi
    STATUS=${STATUS:-IN_PROGRESS}
    echo "Scan status: $STATUS. Waiting 5s (attempt $i/60)..."
    sleep 5
done

if [ "$STATUS" != "COMPLETE" ]; then
    echo "❌ [SECURITY-GATE] FAILED CLOSED: scan for $REPO_NAME:$IMAGE_TAG did not complete (status=$STATUS)."
    exit 1
fi

CRITICAL=$(aws ecr describe-image-scan-findings --repository-name "$REPO_NAME" --image-id imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageScanFindings.findingSeverityCounts.CRITICAL" --output text)
HIGH=$(aws ecr describe-image-scan-findings --repository-name "$REPO_NAME" --image-id imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageScanFindings.findingSeverityCounts.HIGH" --output text)
DIGEST=$(aws ecr describe-images --repository-name "$REPO_NAME" --image-ids imageTag="$IMAGE_TAG" --region "$AWS_REGION" --query "imageDetails[0].imageDigest" --output text)

[ "$CRITICAL" = "None" ] && CRITICAL=0
[ "$HIGH" = "None" ] && HIGH=0

echo "📊 [SECURITY-GATE] $REPO_NAME findings: CRITICAL=$CRITICAL, HIGH=$HIGH"

if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
    echo "❌ [SECURITY-GATE] VIOLATION: $REPO_NAME has $CRITICAL CRITICAL and $HIGH HIGH vulnerabilities!"
    exit 1
fi

# Append finding record to a local JSON tracking file
SUMMARY_FILE="ecr-scan-summary.json"
tmp=$(mktemp)
if [ -f "$SUMMARY_FILE" ] && [ -s "$SUMMARY_FILE" ]; then
    python3 -c "
import json, sys
data = json.load(open('$SUMMARY_FILE'))
data.append({'repository': '$REPO_NAME', 'tag': '$IMAGE_TAG', 'digest': '$DIGEST', 'critical': $CRITICAL, 'high': $HIGH})
with open('$tmp', 'w') as f:
    json.dump(data, f, indent=2)
"
    mv "$tmp" "$SUMMARY_FILE"
else
    cat <<EOF > "$SUMMARY_FILE"
[
  {
    "repository": "$REPO_NAME",
    "tag": "$IMAGE_TAG",
    "digest": "$DIGEST",
    "critical": $CRITICAL,
    "high": $HIGH
  }
]
EOF
fi

echo "✅ [SECURITY-GATE] $SERVICE passed vulnerability scan (CRITICAL=0, HIGH=0)"
