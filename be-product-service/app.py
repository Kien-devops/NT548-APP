import os
from functools import wraps

import jwt
from flask import Flask, jsonify
from flask import request
from flask_cors import CORS


app = Flask(__name__)
CORS(app)
PORT = int(os.environ.get("PORT", "5002"))
JWT_SECRET = os.environ.get("JWT_SECRET", "nt548-local-development-secret")

PRODUCTS = [
    {"id": 101, "name": "AWS Fargate Cluster v2", "category": "Cloud Computing", "price": 49.99},
    {"id": 102, "name": "Terraform Enterprise Blueprint", "category": "DevOps Tools", "price": 89.00},
    {"id": 103, "name": "Docker & Kubernetes Master", "category": "Containerization", "price": 29.50},
    {"id": 104, "name": "Prometheus & Grafana", "category": "Observability", "price": 35.00},
]


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
    return jsonify(PRODUCTS), 200


@app.get("/api/products/<int:product_id>")
@require_auth
def get_product(product_id):
    product = next((item for item in PRODUCTS if item["id"] == product_id), None)
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
    app.run(host="0.0.0.0", port=PORT)
