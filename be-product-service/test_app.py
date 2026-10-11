import os
import time
import unittest
from decimal import Decimal
from unittest.mock import patch

import jwt
import psycopg

os.environ["JWT_SECRET"] = "test-only-jwt-secret-with-at-least-32-characters"

from app import app


class ProductServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

        # Thay hàm kết nối DB bằng mock trong mỗi bài test.
        db_patch = patch("app.get_db_connection")
        self.mock_connect = db_patch.start()
        self.addCleanup(db_patch.stop)

        # Connection được dùng bên trong "with".
        self.conn = (
            self.mock_connect.return_value.__enter__.return_value
        )

        token = jwt.encode(
            {
                "sub": "test-user",
                "exp": int(time.time()) + 300,
            },
            os.environ["JWT_SECRET"],
            algorithm="HS256",
        )
        self.headers = {"Authorization": f"Bearer {token}"}

    def sample_product(self):
        return {
            "id": 101,
            "name": "Product from database",
            "category": "Cloud Computing",
            "price": Decimal("49.99"),
        }

    def test_health_is_public(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()["service"], "product-service"
        )
        self.mock_connect.assert_not_called()

    def test_products_require_auth(self):
        for path in ["/api/products", "/api/products/101"]:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)

        self.mock_connect.assert_not_called()

    def test_products_return_database_data(self):
        self.conn.execute.return_value.fetchall.return_value = [
            self.sample_product()
        ]

        response = self.client.get(
            "/api/products", headers=self.headers
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), [{
            "id": 101,
            "name": "Product from database",
            "category": "Cloud Computing",
            "price": 49.99,
        }])

    def test_product_detail_returns_database_data(self):
        self.conn.execute.return_value.fetchone.return_value = (
            self.sample_product()
        )

        response = self.client.get(
            "/api/products/101", headers=self.headers
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["id"], 101)
        self.assertEqual(response.get_json()["price"], 49.99)

        # ID phải được truyền riêng dưới dạng tham số SQL.
        self.assertEqual(
            self.conn.execute.call_args.args[1], (101,)
        )

    def test_missing_product_returns_404(self):
        self.conn.execute.return_value.fetchone.return_value = None

        response = self.client.get(
            "/api/products/999", headers=self.headers
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.get_json()["error"], "NOT_FOUND"
        )

    def test_database_failure_returns_503(self):
        self.mock_connect.side_effect = psycopg.OperationalError(
            "Database unavailable in test"
        )

        with self.assertLogs(app.logger, level="ERROR"):
            response = self.client.get(
                "/api/products", headers=self.headers
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json()["error"], "DATABASE_UNAVAILABLE"
        )


if __name__ == "__main__":
    unittest.main()