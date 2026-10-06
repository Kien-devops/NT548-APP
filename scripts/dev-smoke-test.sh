#!/bin/bash
set -eo pipefail

AWS_REGION="${AWS_REGION:-ap-southeast-1}"

# Auto-discover the account-local ALB when BASE_URL is not injected by CodeBuild.
if [ -z "${BASE_URL:-}" ]; then
    DISCOVERED_ALB=$(aws elbv2 describe-load-balancers --names nt548-shared-alb --region "$AWS_REGION" --query "LoadBalancers[0].DNSName" --output text 2>/dev/null || true)
    if [ -n "$DISCOVERED_ALB" ] && [ "$DISCOVERED_ALB" != "None" ]; then
        BASE_URL="http://$DISCOVERED_ALB"
    else
        echo "❌ ERROR: BASE_URL is unset and nt548-shared-alb could not be discovered in $AWS_REGION."
        exit 1
    fi
fi
COOKIE_HEADER="Cookie: nt548-test=true"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@nt548.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-nt548-demo}"
MAX_RETRIES=50
RETRY_INTERVAL=5

echo "=================================================="
echo "🧪 NT548 DEV EPHEMERAL SMOKE TEST"
echo "Target Base URL: $BASE_URL"
echo "Routing Cookie : $COOKIE_HEADER"
echo "=================================================="

echo "[1/4] ⏳ Polling DEV /health endpoint..."
success=0
for i in $(seq 1 $MAX_RETRIES); do
    response=$(curl -sk -w "\n%{http_code}" -H "$COOKIE_HEADER" "$BASE_URL/health" || true)
    body=$(echo "$response" | head -n -1)
    status_code=$(echo "$response" | tail -n 1)

    if [ "$status_code" = "200" ]; then
        echo "✅ DEV Service is healthy (attempt $i/$MAX_RETRIES). Response: $body"
        success=1
        break
    else
        echo "⏳ Waiting for DEV healthy status... (attempt $i/$MAX_RETRIES, status: $status_code)"
        sleep $RETRY_INTERVAL
    fi
done

if [ $success -ne 1 ]; then
    echo "❌ ERROR: DEV Service failed health check within timeout."
    exit 1
fi

echo "[2/4] 🔑 Testing Login: POST /api/users/login..."
login_resp=$(curl -sk -w "\n%{http_code}" -X POST "$BASE_URL/api/users/login" \
    -H "$COOKIE_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

login_body=$(echo "$login_resp" | head -n -1)
login_status=$(echo "$login_resp" | tail -n 1)

if [ "$login_status" != "200" ]; then
    echo "❌ ERROR: Login failed with HTTP status $login_status. Response: $login_body"
    exit 1
fi

TOKEN=$(echo "$login_body" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4 || true)
if [ -z "$TOKEN" ]; then
    # Fallback to python json parse if grep fails
    TOKEN=$(python3 -c "import sys, json; print(json.loads(sys.argv[1]).get('access_token', ''))" "$login_body" 2>/dev/null || true)
fi

if [ -z "$TOKEN" ]; then
    echo "❌ ERROR: Could not parse access_token from login response: $login_body"
    exit 1
fi
echo "✅ Authenticated successfully! Token acquired: ${TOKEN:0:15}..."

echo "[3/4] 📦 Testing Products: GET /api/products..."
prod_resp=$(curl -sk -w "\n%{http_code}" -H "$COOKIE_HEADER" -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/products")
prod_body=$(echo "$prod_resp" | head -n -1)
prod_status=$(echo "$prod_resp" | tail -n 1)

if [ "$prod_status" != "200" ]; then
    echo "❌ ERROR: GET /api/products failed with HTTP status $prod_status. Response: $prod_body"
    exit 1
fi
echo "✅ Products API returned HTTP 200: $prod_body"

echo "[4/4] 🛒 Testing Orders: GET /api/orders..."
order_resp=$(curl -sk -w "\n%{http_code}" -H "$COOKIE_HEADER" -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/orders")
order_body=$(echo "$order_resp" | head -n -1)
order_status=$(echo "$order_resp" | tail -n 1)

if [ "$order_status" != "200" ]; then
    echo "❌ ERROR: GET /api/orders failed with HTTP status $order_status. Response: $order_body"
    exit 1
fi
echo "✅ Orders API returned HTTP 200: $order_body"

echo "=================================================="
echo "🎉 ALL DEV SMOKE TESTS PASSED SUCCESSFULLY!"
echo "=================================================="
exit 0
