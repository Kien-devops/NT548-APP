#!/bin/bash
set -eo pipefail

ACCOUNT_ID="$1"
AWS_REGION="${2:-ap-southeast-1}"
IMAGE_TAG="$3"

if [ -z "$ACCOUNT_ID" ] || [ -z "$IMAGE_TAG" ]; then
    echo "Usage: $0 <account-id> <region> <image-tag>"
    exit 1
fi

for service in frontend user product order; do
    file="imagedefinitions-${service}.json"
    printf '[{"name":"%s","imageUri":"%s.dkr.ecr.%s.amazonaws.com/nt548-prod-%s:%s"}]\n' \
        "$service" "$ACCOUNT_ID" "$AWS_REGION" "$service" "$IMAGE_TAG" > "$file"
    echo "Generated $file:"
    cat "$file"
done
