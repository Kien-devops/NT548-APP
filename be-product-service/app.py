import json
import logging
import os
import time
from functools import wraps

import jwt
from opentelemetry import trace
from flask import Flask, jsonify
from flask import request
from flask_cors import CORS
import pymysql

# CI selective-deploy verification: product-only revision.

app = Flask(__name__)
CORS(app)
PORT = int(os.environ.get("PORT", "5002"))
JWT_SECRET = os.environ.get("JWT_SECRET", "nt548-local-development-secret")
logger = logging.getLogger("nt548-prod-product-service")
logger.setLevel(logging.INFO)

PRODUCTS = [
    {"id": 101, "name": "AWS Fargate Cluster v2", "category": "Cloud Computing", "price": 49.99},
    {"id": 102, "name": "Terraform Enterprise Blueprint", "category": "DevOps Tools", "price": 89.00},
    {"id": 103, "name": "Docker & Kubernetes Master", "category": "Containerization", "price": 29.50},
    {"id": 104, "name": "Prometheus & Grafana", "category": "Observability", "price": 35.00},
]
DB = None
if os.environ.get("DB_HOST") and os.environ.get("DB_USER") and os.environ.get("DB_PASSWORD"):
    DB = dict(host=os.environ["DB_HOST"], port=int(os.environ.get("DB_PORT", "3306")), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], database=os.environ.get("DB_NAME", "nt548"), cursorclass=pymysql.cursors.DictCursor, autocommit=True)

def db_rows(query, args=()):
    if not DB:
        return None
    with pymysql.connect(**DB) as conn, conn.cursor() as cursor:
        cursor.execute(query, args)
        return cursor.fetchall() if cursor.description else []

def init_database():
    if not DB:
        return
    with pymysql.connect(**DB) as conn, conn.cursor() as cursor:
        cursor.execute("CREATE TABLE IF NOT EXISTS products (id INT PRIMARY KEY, name VARCHAR(160) NOT NULL, category VARCHAR(120) NOT NULL, price DECIMAL(12,2) NOT NULL, stock INT NOT NULL DEFAULT 0)")
        cursor.executemany("INSERT INTO products (id, name, category, price, stock) VALUES (%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE name=VALUES(name), category=VALUES(category), price=VALUES(price)", [(p["id"], p["name"], p["category"], p["price"], 100) for p in PRODUCTS])

init_database()


@app.before_request
def start_request_timer():
    request._nt548_started_at = time.perf_counter()


@app.after_request
def log_request(response):
    if request.path not in {"/health", "/api/products/health"}:
        context = trace.get_current_span().get_span_context()
        logger.info(
            json.dumps(
                {
                    "service": "nt548-prod-product-service",
                    "environment": os.environ.get("ENVIRONMENT", "unknown"),
                    "trace_id": format(context.trace_id, "032x") if context.is_valid else None,
                    "span_id": format(context.span_id, "016x") if context.is_valid else None,
                    "method": request.method,
                    "route": request.url_rule.rule if request.url_rule else request.path,
                    "status_code": response.status_code,
                    "duration_ms": round((time.perf_counter() - request._nt548_started_at) * 1000, 2),
                },
                ensure_ascii=False,
            )
        )
    return response


def require_auth(handler):
    @wraps(handler)
    def protected_handler(*args, **kwargs):
        authorization = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            return jsonify({"error": "UNAUTHORIZED", "message": "Bạn cần đăng nhập để xem sản phẩm."}), 401

        try:
            request.auth = jwt.decode(
                authorization[7:],
                JWT_SECRET,
                algorithms=["HS256"],
                options={"require": ["sub", "exp"]},
            )
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "TOKEN_EXPIRED", "message": "Phiên đăng nhập đã hết hạn."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "INVALID_TOKEN", "message": "Access token không hợp lệ."}), 401

        return handler(*args, **kwargs)

    return protected_handler


@app.get("/health")
@app.get("/api/products/health")
def health():
    return jsonify({"status": "healthy", "service": "product-service", "port": PORT}), 200


@app.get("/api/products")
@require_auth
def list_products():
    rows = db_rows("SELECT id, name, category, price, stock FROM products ORDER BY id") if DB else PRODUCTS
    return jsonify(rows), 200


@app.post("/api/products")
@require_auth
def create_product():
    payload = request.get_json(silent=True) or {}
    try:
        product = {
            "id": int(payload["id"]),
            "name": str(payload["name"]).strip(),
            "category": str(payload["category"]).strip(),
            "price": float(payload["price"]),
        }
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "VALIDATION_ERROR", "message": "id, name, category và price là bắt buộc."}), 400
    if not product["name"] or not product["category"] or product["price"] < 0:
        return jsonify({"error": "VALIDATION_ERROR", "message": "Dữ liệu sản phẩm không hợp lệ hoặc id đã tồn tại."}), 400
    if DB:
        try:
            db_rows("INSERT INTO products (id, name, category, price, stock) VALUES (%s,%s,%s,%s,%s)", (product["id"], product["name"], product["category"], product["price"], int(payload.get("stock", 100))))
        except pymysql.IntegrityError:
            return jsonify({"error": "VALIDATION_ERROR", "message": "id đã tồn tại."}), 400
        return jsonify(product), 201
    if any(item["id"] == product["id"] for item in PRODUCTS):
        return jsonify({"error": "VALIDATION_ERROR", "message": "id đã tồn tại."}), 400
    PRODUCTS.append(product)
    return jsonify(product), 201


@app.put("/api/products/<int:product_id>")
@require_auth
def update_product(product_id):
    if DB:
        current = (db_rows("SELECT id, name, category, price, stock FROM products WHERE id=%s", (product_id,)) or [None])[0]
        if current is None:
            return jsonify({"error": "NOT_FOUND", "message": "Không tìm thấy sản phẩm."}), 404
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", current["name"])).strip()
        category = str(payload.get("category", current["category"])).strip()
        try:
            price = float(payload.get("price", current["price"]))
            stock = int(payload.get("stock", current["stock"]))
        except (TypeError, ValueError):
            return jsonify({"error": "VALIDATION_ERROR", "message": "price và stock không hợp lệ."}), 400
        if not name or not category or price < 0 or stock < 0:
            return jsonify({"error": "VALIDATION_ERROR", "message": "Dữ liệu sản phẩm không hợp lệ."}), 400
        db_rows("UPDATE products SET name=%s, category=%s, price=%s, stock=%s WHERE id=%s", (name, category, price, stock, product_id))
        return jsonify({"id": product_id, "name": name, "category": category, "price": price, "stock": stock}), 200
    product = next((item for item in PRODUCTS if item["id"] == product_id), None)
    if product is None:
        return jsonify({"error": "NOT_FOUND", "message": "Không tìm thấy sản phẩm."}), 404
    payload = request.get_json(silent=True) or {}
    for field in ("name", "category"):
        if field in payload and str(payload[field]).strip():
            product[field] = str(payload[field]).strip()
    if "price" in payload:
        try:
            product["price"] = float(payload["price"])
        except (TypeError, ValueError):
            return jsonify({"error": "VALIDATION_ERROR", "message": "price phải là số không âm."}), 400
    if product["price"] < 0:
        return jsonify({"error": "VALIDATION_ERROR", "message": "price phải là số không âm."}), 400
    return jsonify(product), 200


@app.delete("/api/products/<int:product_id>")
@require_auth
def delete_product(product_id):
    if DB:
        existing = db_rows("SELECT id FROM products WHERE id=%s", (product_id,))
        if not existing:
            return jsonify({"error": "NOT_FOUND", "message": "Không tìm thấy sản phẩm."}), 404
        db_rows("DELETE FROM products WHERE id=%s", (product_id,))
        return jsonify({"deleted": product_id}), 200
    product = next((item for item in PRODUCTS if item["id"] == product_id), None)
    if product is None:
        return jsonify({"error": "NOT_FOUND", "message": "Không tìm thấy sản phẩm."}), 404
    PRODUCTS.remove(product)
    return jsonify({"deleted": product_id}), 200


@app.get("/api/products/<int:product_id>")
@require_auth
def get_product(product_id):
    product = (db_rows("SELECT id, name, category, price, stock FROM products WHERE id=%s", (product_id,)) or [None])[0] if DB else next((item for item in PRODUCTS if item["id"] == product_id), None)
    if product is None:
        return jsonify({"error": "NOT_FOUND", "message": "Không tìm thấy sản phẩm."}), 404
    return jsonify(product), 200


@app.errorhandler(404)
def route_not_found(_error):
    return jsonify({"error": "NOT_FOUND", "message": "Endpoint không tồn tại."}), 404


@app.errorhandler(500)
def internal_error(_error):
    return jsonify({"error": "INTERNAL_ERROR", "message": "Dịch vụ sản phẩm gặp lỗi."}), 500


if __name__ == "__main__":
    init_database()
    app.run(host="0.0.0.0", port=PORT)
