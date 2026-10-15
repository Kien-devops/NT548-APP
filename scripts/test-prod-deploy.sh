#!/bin/bash
set -euo pipefail

# Windows Git Bash may expose a blocked python3 shim; python.exe remains usable.
export PYTHON_BIN="${PYTHON_BIN:-python}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin"
mkdir -p "$test_root/state"
cp "$repo_root/scripts/prod-deploy.sh" "$test_root/prod-deploy.sh"

cat > "$test_root/bin/aws" <<'AWS'
#!/bin/bash
set -euo pipefail
command="$1 $2"
shift 2
case "$command" in
  "ecs describe-services")
    service=""
    query=""
    output="text"
    while (($#)); do
      [[ "$1" == "--services" ]] && service="$2"
      [[ "$1" == "--query" ]] && query="$2"
      [[ "$1" == "--output" ]] && output="$2"
      shift
    done
    active="$(cat "$AWS_STATE_DIR/$service")"
    if [[ "$output" == "json" ]]; then
      "${PYTHON_BIN:-python3}" - "$active" <<'PY'
import json, sys
task_definition = sys.argv[1]
print(json.dumps({"taskDefinition": task_definition, "deployments": [{"status": "PRIMARY", "taskDefinition": task_definition, "rolloutState": "COMPLETED"}]}))
PY
    else
      printf '%s\n' "$active"
    fi
    ;;
  "ecs describe-task-definition")
    cat <<'JSON'
{"taskDefinitionArn":"managed","revision":7,"status":"ACTIVE","requiresAttributes":[],"compatibilities":["EC2","FARGATE"],"registeredAt":"managed","registeredBy":"managed","family":"nt548-prod","taskRoleArn":"arn:task-role","executionRoleArn":"arn:execution-role","networkMode":"awsvpc","cpu":"512","memory":"1024","requiresCompatibilities":["FARGATE"],"runtimePlatform":{"cpuArchitecture":"X86_64","operatingSystemFamily":"LINUX"},"containerDefinitions":[{"name":"frontend","image":"old/frontend"},{"name":"user","image":"old/user"},{"name":"product","image":"old/product","environment":[{"name":"OTEL_SERVICE_NAME","value":"product"}]},{"name":"order","image":"old/order","secrets":[{"name":"DB_PASSWORD","valueFrom":"secret"}]},{"name":"adot-collector","image":"adot:stable","logConfiguration":{"logDriver":"awslogs"}}],"volumes":[]}
JSON
    ;;
  "ecs register-task-definition")
    file=""
    while (($#)); do [[ "$1" == "--cli-input-json" ]] && file="${2#file://}" && break; shift; done
    "${PYTHON_BIN:-python3}" - "$file" <<'PY'
import json, os, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert not ({"taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities", "registeredAt", "registeredBy"} & data.keys())
assert next(c for c in data["containerDefinitions"] if c["name"] == "adot-collector")["image"] == "adot:stable"
with open(os.environ["AWS_LOG"], "a", encoding="utf-8") as log:
    log.write("register " + os.path.basename(sys.argv[1]) + "\n")
PY
    printf 'arn:aws:ecs:test:task-definition/new:8\n'
    ;;
  "ecs update-service")
    service=""
    task_definition=""
    while (($#)); do
      [[ "$1" == "--service" ]] && service="$2"
      [[ "$1" == "--task-definition" ]] && task_definition="$2"
      shift
    done
    printf 'update %s\n' "$service" >> "$AWS_LOG"
    [[ "${FAKE_FAIL_SERVICE:-}" != "$service" ]]
    if [[ "${FAKE_ROLLBACK:-false}" == "true" ]]; then
      printf 'arn:aws:ecs:test:task-definition/%s:7\n' "$service" > "$AWS_STATE_DIR/$service"
    else
      printf '%s\n' "$task_definition" > "$AWS_STATE_DIR/$service"
    fi
    ;;
  "ecs wait")
    service=""
    while (($#)); do [[ "$1" == "--services" ]] && service="$2"; shift; done
    printf 'wait-start %s\n' "$service" >> "$AWS_LOG"
    sleep 1
    printf 'wait-end %s\n' "$service" >> "$AWS_LOG"
    ;;
  *) echo "unexpected aws command: $command" >&2; exit 1 ;;
esac
AWS
chmod +x "$test_root/bin/aws" "$test_root/prod-deploy.sh"

write_case() {
  printf 'export FRONTEND_CHANGED=%s\nexport USER_CHANGED=%s\nexport PRODUCT_CHANGED=%s\nexport ORDER_CHANGED=%s\n' "$1" "$2" "$3" "$4" > changed_components.env
  for service in frontend user product order; do printf '[{"name":"%s","imageUri":"ecr/%s:new"}]\n' "$service" "$service" > "imagedefinitions-${service}.json"; done
  rm -f "$AWS_STATE_DIR"/*
  for service in nt548-prod-frontend nt548-prod-user nt548-prod-product nt548-prod-order; do
    printf 'arn:aws:ecs:test:task-definition/%s:7\n' "$service" > "$AWS_STATE_DIR/$service"
  done
  : > aws.log
}

cd "$test_root"
export PATH="$test_root/bin:$PATH" AWS_LOG="$test_root/aws.log" AWS_STATE_DIR="$test_root/state"

write_case false false false false
./prod-deploy.sh | grep -q 'No application service changes detected'
[[ ! -s aws.log ]]

write_case false false true false
./prod-deploy.sh
[[ "$(grep -c '^register ' aws.log)" == 1 ]] && grep -q 'product' aws.log

write_case false false true true
./prod-deploy.sh
[[ "$(grep -c '^register ' aws.log)" == 2 ]]
[[ "$(grep -n '^wait-start ' aws.log | tail -1 | cut -d: -f1)" -lt "$(grep -n '^wait-end ' aws.log | head -1 | cut -d: -f1)" ]]

write_case true true true true
./prod-deploy.sh
[[ "$(grep -c '^register ' aws.log)" == 4 ]]

write_case false false true true
if FAKE_FAIL_SERVICE=nt548-prod-order ./prod-deploy.sh; then echo 'expected background failure' >&2; exit 1; fi

write_case false false true false
if FAKE_ROLLBACK=true ./prod-deploy.sh; then echo 'expected rollback verification failure' >&2; exit 1; fi

echo "prod-deploy self-check passed"
