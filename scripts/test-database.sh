#!/bin/bash
# Run PostgreSQL initialization tests in disposable containers, without AWS credentials.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

# Windows Git Bash must pass container paths to Docker unchanged.
export MSYS_NO_PATHCONV=1
TEST_DIRECTORY="$REPO_ROOT/database/test"
if command -v cygpath >/dev/null 2>&1; then
    TEST_DIRECTORY="$(cygpath -m "$TEST_DIRECTORY")"
fi

RUN_ID="$(date +%s)$$"
NETWORK_NAME="nt548-db-test-$RUN_ID"
POSTGRES_NAME="nt548-db-test-postgres-$RUN_ID"
IMAGE_NAME="nt548-db-test:$RUN_ID"
NETWORK_ID=""
POSTGRES_ID=""
IMAGE_BUILT=false

cleanup() {
    local result=$?
    trap - EXIT
    if [ -n "$POSTGRES_ID" ]; then docker rm -f "$POSTGRES_ID" >/dev/null 2>&1 || true; fi
    if [ -n "$NETWORK_ID" ]; then docker network rm "$NETWORK_ID" >/dev/null 2>&1 || true; fi
    if [ "$IMAGE_BUILT" = true ]; then docker image rm "$IMAGE_NAME" >/dev/null 2>&1 || true; fi
    exit "$result"
}
trap cleanup EXIT

# These random credentials exist only for the temporary test cluster.
export POSTGRES_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
export POSTGRES_DB="nt548_bootstrap_test_$RUN_ID"
export DB_HOST="$POSTGRES_NAME" DB_PORT=5432 DB_NAME="$POSTGRES_DB" DB_USER=postgres DB_PASSWORD="$POSTGRES_PASSWORD"
export USER_DB_PASSWORD="$POSTGRES_PASSWORD" PRODUCT_DB_PASSWORD="$POSTGRES_PASSWORD" ORDER_DB_PASSWORD="$POSTGRES_PASSWORD"
export ADMIN_EMAIL=admin@nt548.local ADMIN_PASSWORD="$POSTGRES_PASSWORD"

NETWORK_ID=$(docker network create "$NETWORK_NAME")
POSTGRES_ID=$(docker run -d --name "$POSTGRES_NAME" --network "$NETWORK_NAME" \
    --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_PASSWORD -e POSTGRES_DB postgres:16)

ready=false
for attempt in $(seq 1 45); do
    # Test the final TCP server, not the initdb bootstrap socket.
    if docker exec "$POSTGRES_ID" pg_isready -h 127.0.0.1 -U postgres -d "$POSTGRES_DB" >/dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
if [ "$ready" != true ]; then
    echo "PostgreSQL test container did not become ready."
    exit 1
fi

docker build --tag "$IMAGE_NAME" database
IMAGE_BUILT=true
docker run --rm --network "$NETWORK_NAME" \
    --mount "type=bind,source=$TEST_DIRECTORY,target=/app/test,readonly" \
    -e DB_HOST -e DB_PORT -e DB_NAME -e DB_USER -e DB_PASSWORD \
    -e USER_DB_PASSWORD -e PRODUCT_DB_PASSWORD -e ORDER_DB_PASSWORD \
    -e ADMIN_EMAIL -e ADMIN_PASSWORD \
    "$IMAGE_NAME" npm test
