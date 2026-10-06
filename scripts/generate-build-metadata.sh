#!/bin/bash
# ==============================================================================
# generate-build-metadata.sh — Generates build_metadata.json artifact
# ==============================================================================
set -euo pipefail

COMMIT_HASH="${1:-${COMMIT_HASH:-}}"
IMAGE_TAG="${2:-${IMAGE_TAG:-}}"
ENV_NAME="${3:-${ENVIRONMENT:-dev}}"
CHANGED_ENV="${4:-changed_components.env}"

if [ -f "$CHANGED_ENV" ]; then
    # shellcheck source=/dev/null
    source "$CHANGED_ENV"
fi

python3 -c "
import json
metadata = {
    'commitHash': '$COMMIT_HASH',
    'imageTag': '$IMAGE_TAG',
    'environment': '$ENV_NAME',
    'components': {
        'frontend': '${FRONTEND_CHANGED:-false}' == 'true',
        'user': '${USER_CHANGED:-false}' == 'true',
        'product': '${PRODUCT_CHANGED:-false}' == 'true',
        'order': '${ORDER_CHANGED:-false}' == 'true',
        'database': '${DATABASE_CHANGED:-false}' == 'true'
    }
}
with open('build_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=2)
"

echo "✅ [METADATA] Generated build_metadata.json:"
cat build_metadata.json
