require("./telemetry");

const crypto = require("crypto");
const { trace } = require("@opentelemetry/api");
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = Number(process.env.PORT || 5003);
const JWT_SECRET = process.env.JWT_SECRET || "nt548-local-development-secret";
const db = process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD
  ? mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || "nt548", waitForConnections: true, connectionLimit: 4 })
  : null;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL;
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;

const orders = [
  { order_id: "ORD-9021", customer: "Nguyễn Văn A", total: 49.99, status: "COMPLETED" },
  { order_id: "ORD-9022", customer: "Trần Thị B", total: 118.5, status: "PROCESSING" },
  { order_id: "ORD-9023", customer: "Lê Văn C", total: 35.0, status: "COMPLETED" },
];

async function initDatabase() {
  if (!db) return;
  await db.query("CREATE TABLE IF NOT EXISTS orders (order_id VARCHAR(64) PRIMARY KEY, customer VARCHAR(160) NOT NULL, total DECIMAL(12,2) NOT NULL, status VARCHAR(32) NOT NULL, user_id VARCHAR(64) NULL, product_id INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await db.query("INSERT INTO orders (order_id, customer, total, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE customer=VALUES(customer), total=VALUES(total), status=VALUES(status)", [orders[0].order_id, orders[0].customer, orders[0].total, orders[0].status]);
}

async function validateDependencies(req, body) {
  const headers = { Accept: "application/json", Authorization: req.get("authorization") || "" };
  if (body.user_id && USER_SERVICE_URL) {
    const response = await fetch(`${USER_SERVICE_URL}/${encodeURIComponent(body.user_id)}`, { headers });
    if (!response.ok) throw new Error("USER_NOT_FOUND");
  }
  if (body.product_id && PRODUCT_SERVICE_URL) {
    const response = await fetch(`${PRODUCT_SERVICE_URL}/${encodeURIComponent(body.product_id)}`, { headers });
    if (!response.ok) throw new Error("PRODUCT_NOT_FOUND");
  }
}

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (req.path === "/health" || req.path === "/api/orders/health") return;
    const context = trace.getActiveSpan()?.spanContext();
    console.log(JSON.stringify({ service: "nt548-prod-order-service", method: req.method, route: req.route?.path || req.path, status_code: res.statusCode, duration_ms: Number(process.hrtime.bigint() - started) / 1e6, trace_id: context?.traceId || null, span_id: context?.spanId || null }));
  });
  next();
});

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

app.get("/api/orders", authenticate, async (_req, res) => {
  if (!db) return res.status(200).json(orders);
  try { const [rows] = await db.query("SELECT order_id, customer, total, status, user_id, product_id FROM orders ORDER BY created_at DESC"); res.status(200).json(rows); }
  catch { res.status(503).json({ error: "DATABASE_UNAVAILABLE" }); }
});

app.post("/api/orders", authenticate, async (req, res) => {
  const { order_id, customer, total, status = "PENDING", user_id, product_id } = req.body || {};
  const numericTotal = Number(total);
  if (!order_id || !customer || !Number.isFinite(numericTotal) || numericTotal < 0 || orders.some((item) => item.order_id === order_id)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "order_id, customer và total hợp lệ là bắt buộc." });
  }
  try { await validateDependencies(req, req.body || {}); } catch (error) { return res.status(400).json({ error: error.message, message: "User hoặc product không tồn tại." }); }
  const order = { order_id: String(order_id), customer: String(customer), total: numericTotal, status: String(status), user_id, product_id };
  if (db) { try { await db.query("INSERT INTO orders (order_id, customer, total, status, user_id, product_id) VALUES (?, ?, ?, ?, ?, ?)", [order.order_id, order.customer, order.total, order.status, user_id || null, product_id || null]); } catch { return res.status(503).json({ error: "DATABASE_UNAVAILABLE" }); } }
  orders.push(order);
  return res.status(201).json(order);
});

app.put("/api/orders/:orderId", authenticate, async (req, res) => {
  if (db) {
    const { customer, total, status } = req.body || {};
    const numericTotal = total === undefined ? undefined : Number(total);
    if (numericTotal !== undefined && (!Number.isFinite(numericTotal) || numericTotal < 0)) return res.status(400).json({ error: "VALIDATION_ERROR" });
    try { await db.query("UPDATE orders SET customer=COALESCE(?, customer), total=COALESCE(?, total), status=COALESCE(?, status) WHERE order_id=?", [customer ?? null, numericTotal ?? null, status ?? null, req.params.orderId]); const [rows] = await db.query("SELECT order_id, customer, total, status, user_id, product_id FROM orders WHERE order_id=?", [req.params.orderId]); return rows[0] ? res.json(rows[0]) : res.status(404).json({ error: "NOT_FOUND" }); } catch { return res.status(503).json({ error: "DATABASE_UNAVAILABLE" }); }
  }
  const order = orders.find((item) => item.order_id === req.params.orderId);
  if (!order) return res.status(404).json({ error: "NOT_FOUND", message: "Không tìm thấy đơn hàng." });
  const { customer, total, status } = req.body || {};
  if (customer !== undefined) order.customer = String(customer).trim();
  if (total !== undefined) {
    const numericTotal = Number(total);
    if (!Number.isFinite(numericTotal) || numericTotal < 0) return res.status(400).json({ error: "VALIDATION_ERROR", message: "total phải là số không âm." });
    order.total = numericTotal;
  }
  if (status !== undefined) order.status = String(status);
  return res.status(200).json(order);
});

app.delete("/api/orders/:orderId", authenticate, async (req, res) => {
  if (db) { try { const [result] = await db.query("DELETE FROM orders WHERE order_id=?", [req.params.orderId]); return result.affectedRows ? res.json({ deleted: req.params.orderId }) : res.status(404).json({ error: "NOT_FOUND" }); } catch { return res.status(503).json({ error: "DATABASE_UNAVAILABLE" }); } }
  const index = orders.findIndex((item) => item.order_id === req.params.orderId);
  if (index < 0) return res.status(404).json({ error: "NOT_FOUND", message: "Không tìm thấy đơn hàng." });
  orders.splice(index, 1);
  return res.status(200).json({ deleted: req.params.orderId });
});

app.get("/api/orders/:orderId", authenticate, async (req, res) => {
  if (db) { try { const [rows] = await db.query("SELECT order_id, customer, total, status, user_id, product_id FROM orders WHERE order_id=?", [req.params.orderId]); return rows[0] ? res.json(rows[0]) : res.status(404).json({ error: "NOT_FOUND" }); } catch { return res.status(503).json({ error: "DATABASE_UNAVAILABLE" }); } }
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

if (require.main === module) initDatabase().then(() => startServer()).catch((error) => { console.error("[ORDER] Database initialization failed", error); process.exit(1); });

module.exports = { app, startServer };
