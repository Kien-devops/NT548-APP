#!/bin/bash
set -euo pipefail

echo "ERROR: scripts/prod-deploy.sh is deprecated."
echo "Production deployments must use the native CodePipeline ECS deploy actions"
echo "with the per-service imagedefinitions-<service>.json artifacts."
exit 1
