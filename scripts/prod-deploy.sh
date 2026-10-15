#!/bin/bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
CLUSTER_NAME="${CLUSTER_NAME:-nt548-cluster}"
COMPONENTS_FILE="${COMPONENTS_FILE:-changed_components.env}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

[[ -f "$COMPONENTS_FILE" ]] || { echo "[ERROR] Missing $COMPONENTS_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
source "$COMPONENTS_FILE"

for flag_name in FRONTEND_CHANGED USER_CHANGED PRODUCT_CHANGED ORDER_CHANGED; do
  flag_value="${!flag_name:-}"
  [[ "$flag_value" == "true" || "$flag_value" == "false" ]] || { echo "[ERROR] Invalid or missing $flag_name in $COMPONENTS_FILE" >&2; exit 1; }
done

deploy_service() {
  local service="$1" flag container ecs_service image_definition current_task_definition current_definition register_definition new_task_definition image_uri
  case "$service" in
    frontend) flag="${FRONTEND_CHANGED:-false}"; container=frontend; ecs_service=nt548-prod-frontend ;;
    user) flag="${USER_CHANGED:-false}"; container=user; ecs_service=nt548-prod-user ;;
    product) flag="${PRODUCT_CHANGED:-false}"; container=product; ecs_service=nt548-prod-product ;;
    order) flag="${ORDER_CHANGED:-false}"; container=order; ecs_service=nt548-prod-order ;;
    *) echo "[ERROR] Unknown service: $service" >&2; return 1 ;;
  esac
  if [[ "$flag" != "true" ]]; then echo "[SKIP] $service unchanged"; return 0; fi

  image_definition="imagedefinitions-${service}.json"
  [[ -f "$image_definition" ]] || { echo "[ERROR] Missing $image_definition" >&2; return 1; }
  image_uri="$(IMAGE_DEFINITION="$image_definition" CONTAINER_NAME="$container" "$PYTHON_BIN" - <<'PY'
import json, os
items = json.load(open(os.environ["IMAGE_DEFINITION"], encoding="utf-8"))
name = os.environ["CONTAINER_NAME"]
for item in items:
    if item.get("name") == name and item.get("imageUri"):
        print(item["imageUri"])
        break
else:
    raise SystemExit(f"missing image definition for {name}")
PY
)"
  [[ -n "$image_uri" ]] || { echo "[ERROR] Empty image URI for $service" >&2; return 1; }

  current_task_definition="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$ecs_service" --region "$AWS_REGION" --query 'services[0].taskDefinition' --output text)"
  [[ -n "$current_task_definition" && "$current_task_definition" != "None" ]] || { echo "[ERROR] No task definition for $ecs_service" >&2; return 1; }
  current_definition=".taskdef-${service}.json"
  register_definition=".taskdef-${service}-register.json"
  aws ecs describe-task-definition --task-definition "$current_task_definition" --region "$AWS_REGION" --query 'taskDefinition' --output json > "$current_definition"
  IMAGE_URI="$image_uri" CONTAINER_NAME="$container" CURRENT_DEFINITION="$current_definition" REGISTER_DEFINITION="$register_definition" "$PYTHON_BIN" - <<'PY'
import json, os
source = json.load(open(os.environ["CURRENT_DEFINITION"], encoding="utf-8"))
allowed = {"family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators", "ephemeralStorage", "runtimePlatform", "enableFaultInjection"}
definition = {key: value for key, value in source.items() if key in allowed}
name = os.environ["CONTAINER_NAME"]
for item in definition["containerDefinitions"]:
    if item.get("name") == name:
        item["image"] = os.environ["IMAGE_URI"]
        break
else:
    raise SystemExit(f"missing application container {name}")
json.dump(definition, open(os.environ["REGISTER_DEFINITION"], "w", encoding="utf-8"), separators=(",", ":"))
PY
  new_task_definition="$(aws ecs register-task-definition --cli-input-json "file://$register_definition" --region "$AWS_REGION" --query 'taskDefinition.taskDefinitionArn' --output text)"
  rm -f "$current_definition" "$register_definition"
  [[ -n "$new_task_definition" && "$new_task_definition" != "None" ]] || { echo "[ERROR] Registration failed for $service" >&2; return 1; }
  echo "[DEPLOY] $service -> new task definition $new_task_definition"
  aws ecs update-service --cluster "$CLUSTER_NAME" --service "$ecs_service" --task-definition "$new_task_definition" --region "$AWS_REGION" >/dev/null
  current_definition=".taskdef-${service}-verify.json"
  verified=false
  for attempt in $(seq 1 60); do
    aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$ecs_service" --region "$AWS_REGION" --query 'services[0]' --output json > "$current_definition"
    if EXPECTED_TASK_DEFINITION="$new_task_definition" VERIFY_DEFINITION="$current_definition" "$PYTHON_BIN" - <<'PY'
import json, os
service = json.load(open(os.environ["VERIFY_DEFINITION"], encoding="utf-8"))
expected = os.environ["EXPECTED_TASK_DEFINITION"]
active = service.get("taskDefinition")
primary = next((item for item in service.get("deployments", []) if item.get("status") == "PRIMARY"), None)
primary_task_definition = primary.get("taskDefinition") if primary else None
rollout_state = (primary or {}).get("rolloutState")
if active == expected and primary_task_definition == expected and rollout_state in (None, "COMPLETED"):
    raise SystemExit(0)
if rollout_state == "FAILED":
    raise SystemExit(
        f"Deployment rolled back or did not activate expected revision: active={active!r}, primary={primary_task_definition!r}, rolloutState={rollout_state!r}, expected={expected!r}"
    )
PY
    then
      verified=true
      break
    fi
    sleep 10
  done
  [[ "$verified" == "true" ]] || { echo "[ERROR] Timed out waiting for $service deployment to complete" >&2; rm -f "$current_definition"; return 1; }
  rm -f "$current_definition"
  echo "[VERIFY] $service active task definition: $new_task_definition"
}

pids=()
pid_services=()
for service in frontend user product order; do
  case "$service" in
    frontend) changed="${FRONTEND_CHANGED:-false}" ;;
    user) changed="${USER_CHANGED:-false}" ;;
    product) changed="${PRODUCT_CHANGED:-false}" ;;
    order) changed="${ORDER_CHANGED:-false}" ;;
  esac
  if [[ "$changed" == "true" ]]; then deploy_service "$service" & pids+=("$!"); pid_services+=("$service"); else echo "[SKIP] $service unchanged"; fi
done

if ((${#pids[@]} == 0)); then echo "[SKIP] No application service changes detected."; exit 0; fi
failed=0
for index in "${!pids[@]}"; do
  wait "${pids[$index]}" || { echo "[ERROR] ${pid_services[$index]} deployment failed" >&2; failed=1; }
done
exit "$failed"
