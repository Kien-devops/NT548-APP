#!/bin/bash
# ==============================================================================
# test-service.sh — Reusable test runner for NT548-APP microservices
#
# Usage: ./scripts/test-service.sh <frontend|user|product|order|database>
# ==============================================================================
set -euo pipefail

SERVICE="${1:-}"

if [ -z "$SERVICE" ]; then
    echo "Usage: $0 <frontend|user|product|order|database>"
    exit 1
fi

echo "=================================================="
echo "🧪 [TEST] Running tests for: $SERVICE"
echo "=================================================="

case "$SERVICE" in
    user)
        echo "   [TEST] Validating syntax: be-user-service/server.js"
        node -c be-user-service/server.js
        echo "   [TEST] Running unit tests: be-user-service"
        npm test --prefix be-user-service
        ;;
    order)
        echo "   [TEST] Validating syntax: be-order-service/server.js"
        node -c be-order-service/server.js
        echo "   [TEST] Running unit tests: be-order-service"
        npm test --prefix be-order-service
        ;;
    product)
        echo "   [TEST] Validating syntax: be-product-service/app.py"
        python -m py_compile be-product-service/app.py
        echo "   [TEST] Running unit tests: be-product-service"
        PYTHONPATH=be-product-service python -m unittest discover -s be-product-service -p 'test_*.py'
        ;;
    frontend)
        echo "   [TEST] Validating frontend static files and nginx template"
        test -f frontend/Dockerfile || { echo "❌ Missing frontend/Dockerfile"; exit 1; }
        test -f frontend/nginx.conf.template || { echo "❌ Missing frontend/nginx.conf.template"; exit 1; }
        test -f frontend/src/index.html || { echo "❌ Missing frontend/src/index.html"; exit 1; }
        test -f frontend/src/app.js || { echo "❌ Missing frontend/src/app.js"; exit 1; }
        ;;
    database)
        echo "   [TEST] Validating database initialization scripts"
        test -f database/nt548_test_data.sql || { echo "❌ Missing database/nt548_test_data.sql"; exit 1; }
        grep -q "INSERT INTO" database/nt548_test_data.sql || { echo "❌ database SQL appears invalid"; exit 1; }
        ;;
    *)
        echo "❌ Unknown service: $SERVICE"
        exit 1
        ;;
esac

echo "✅ [TEST] $SERVICE tests completed successfully!"
