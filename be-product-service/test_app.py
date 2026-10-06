import os
import unittest

import jwt

os.environ["JWT_SECRET"] = "test-only-jwt-secret-with-at-least-32-characters"

from app import app  # noqa: E402


class ProductServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health_is_public(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["service"], "product-service")

    def test_products_require_auth_and_return_data(self):
        self.assertEqual(self.client.get("/api/products").status_code, 401)
        token = jwt.encode(
            {"sub": "test-user", "exp": 4_102_444_800},
            os.environ["JWT_SECRET"],
            algorithm="HS256",
        )
        response = self.client.get(
            "/api/products", headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.get_json()), 0)


if __name__ == "__main__":
    unittest.main()
