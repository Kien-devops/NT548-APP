import os
from functools import wraps

import jwt
from flask import Flask, jsonify
from flask import request
from flask_cors import CORS

import psycopg
from psycopg.rows import dict_row


app = Flask(__name__)
CORS(app)
PORT = int(os.environ.get("PORT", "5002"))
JWT_SECRET = os.environ.get("JWT_SECRET", "nt548-local-development-secret")

def get_db_connection():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        connect_timeout=5,
        row_factory=dict_row,
    )


def serialize_product(product):
    product["price"] = float(product["price"])
    return product


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
    with get_db_connection() as conn:
        products = conn.execute(
            """
            SELECT id, name, category, price
            FROM products
            WHERE is_active = TRUE
            ORDER BY id
            """
        ).fetchall()

    return jsonify(
        [serialize_product(product) for product in products]
    ), 200


@app.get("/api/products/<int:product_id>")
@require_auth
def get_product(product_id):
    with get_db_connection() as conn:
        product = conn.execute(
            """
            SELECT id, name, category, price
            FROM products
            WHERE id = %s AND is_active = TRUE
            """,
            (product_id,),
        ).fetchone()

    if product is None:
        return jsonify({
            "error": "NOT_FOUND",
            "message": "Không tìm thấy sản phẩm.",
        }), 404

    return jsonify(serialize_product(product)), 200

@app.errorhandler(psycopg.Error)
def database_error(error):
    app.logger.exception("Product database query failed")
    return jsonify({
        "error": "DATABASE_UNAVAILABLE",
        "message": "Không thể đọc dữ liệu sản phẩm.",
    }), 503

@app.errorhandler(404)
def route_not_found(_error):
    return jsonify({"error": "NOT_FOUND", "message": "Endpoint không tồn tại."}), 404


@app.errorhandler(500)
def internal_error(_error):
    return jsonify({"error": "INTERNAL_ERROR", "message": "Dịch vụ sản phẩm gặp lỗi."}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
