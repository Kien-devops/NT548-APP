const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = Number(process.env.PORT || 5003);
const JWT_SECRET = process.env.JWT_SECRET || "nt548-local-development-secret";

const orders = [
  { order_id: "ORD-9021", customer: "Nguyễn Văn A", total: 49.99, status: "COMPLETED" },
  { order_id: "ORD-9022", customer: "Trần Thị B", total: 118.5, status: "PROCESSING" },
  { order_id: "ORD-9023", customer: "Lê Văn C", total: 35.0, status: "COMPLETED" },
];

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) throw new Error("Invalid signature");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Expired token");
  return claims;
}

function authenticate(req, res, next) {
  try {
    const authorization = req.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return res.status(401).json({ error: "UNAUTHORIZED", message: "Bạn cần đăng nhập để xem đơn hàng." });
    req.auth = verifyToken(authorization.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN", message: "Access token không hợp lệ hoặc đã hết hạn." });
  }
}

app.get(["/health", "/api/orders/health"], (_req, res) => {
  res.status(200).json({ status: "healthy", service: "order-service", port: PORT });
});

app.get("/api/orders", authenticate, (_req, res) => {
  res.status(200).json(orders);
});

app.get("/api/orders/:orderId", authenticate, (req, res) => {
  const order = orders.find((item) => item.order_id === req.params.orderId);
  if (!order) return res.status(404).json({ error: "NOT_FOUND", message: "Không tìm thấy đơn hàng." });
  return res.status(200).json(order);
});

app.use((_req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "Endpoint không tồn tại." });
});

app.use((err, _req, res, _next) => {
  console.error("[ORDER] Unhandled error:", err);
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Dịch vụ đơn hàng gặp lỗi." });
});

function startServer(port = PORT) {
  return app.listen(port, "0.0.0.0", () => console.log(`[ORDER] Listening on port ${port}`));
}

if (require.main === module) startServer();

module.exports = { app, startServer };
