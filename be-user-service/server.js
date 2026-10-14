require("./telemetry");

const crypto = require("crypto");
const { trace } = require("@opentelemetry/api");
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = Number(process.env.PORT || 5001);
const JWT_SECRET = process.env.JWT_SECRET || "nt548-local-development-secret";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@nt548.local").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "nt548-demo";
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 3600);
const db = process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD
  ? mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || "nt548", waitForConnections: true, connectionLimit: 4 })
  : null;

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("[AUTH] JWT_SECRET is required when NODE_ENV=production.");
  process.exit(1);
}

const adminUser = {
  id: "usr_admin_001",
  name: "NT548 Administrator",
  email: ADMIN_EMAIL,
  role: "ADMIN",
};

const passwordSalt = crypto.createHash("sha256").update(`nt548:${ADMIN_EMAIL}`).digest();
const passwordHash = crypto.scryptSync(ADMIN_PASSWORD, passwordSalt, 64);
const registeredUsers = new Map();

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return { salt, hash: crypto.scryptSync(password, salt, 64) };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function initDatabase() {
  if (!db) return;
  await db.query("CREATE TABLE IF NOT EXISTS users (id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, role VARCHAR(80) NOT NULL)");
  for (const column of ["password_salt VARBINARY(32) NULL", "password_hash VARBINARY(128) NULL"]) {
    try { await db.query(`ALTER TABLE users ADD COLUMN ${column}`); } catch (error) { if (error.code !== "ER_DUP_FIELDNAME") throw error; }
  }
  await db.query("INSERT INTO users (id, name, email, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), password_salt=VALUES(password_salt), password_hash=VALUES(password_hash)", [adminUser.id, adminUser.name, adminUser.email, adminUser.role, passwordSalt, passwordHash]);
}

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (req.path === "/health" || req.path === "/api/users/health") return;
    const context = trace.getActiveSpan()?.spanContext();
    console.log(JSON.stringify({ service: "nt548-prod-user-service", method: req.method, route: req.route?.path || req.path, status_code: res.statusCode, duration_ms: Number(process.hrtime.bigint() - started) / 1e6, trace_id: context?.traceId || null, span_id: context?.spanId || null }));
  });
  next();
});

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) throw new Error("Invalid signature");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Expired token");
  return claims;
}

function authenticate(req, res, next) {
  try {
    const authorization = req.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return res.status(401).json({ error: "UNAUTHORIZED", message: "Thiếu access token." });
    req.auth = verifyToken(authorization.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN", message: "Access token không hợp lệ hoặc đã hết hạn." });
  }
}

app.get(["/health", "/api/users/health"], (_req, res) => {
  res.status(200).json({ status: "healthy", service: "auth-service", port: PORT });
});

app.post("/api/users/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Email và mật khẩu là bắt buộc." });
  }

  const finishLogin = (user) => res.status(200).json({ access_token: createToken(user), token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, user: publicUser(user) });
  if (email === ADMIN_EMAIL) {
    const candidateHash = crypto.scryptSync(password, passwordSalt, 64);
    if (crypto.timingSafeEqual(candidateHash, passwordHash)) return finishLogin(adminUser);
  }
  if (db) {
    return db.query("SELECT id, name, email, role, password_salt, password_hash FROM users WHERE email = ?", [email])
      .then(([rows]) => {
        const user = rows[0];
        if (!user?.password_salt || !user?.password_hash) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Email hoặc mật khẩu không chính xác." });
        const candidateHash = crypto.scryptSync(password, user.password_salt, 64);
        return crypto.timingSafeEqual(candidateHash, user.password_hash) ? finishLogin(user) : res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Email hoặc mật khẩu không chính xác." });
      })
      .catch(() => res.status(503).json({ error: "DATABASE_UNAVAILABLE" }));
  }
  const user = registeredUsers.get(email);
  if (user) {
    const candidateHash = crypto.scryptSync(password, user.passwordSalt, 64);
    if (crypto.timingSafeEqual(candidateHash, user.passwordHash)) return finishLogin(user);
  }
  return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Email hoặc mật khẩu không chính xác." });
});

app.post("/api/users/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Tên, email hợp lệ và mật khẩu tối thiểu 6 ký tự là bắt buộc." });
  const id = `usr_${crypto.randomUUID()}`;
  const user = { id, name, email, role: "USER" };
  const credentials = hashPassword(password);
  if (email === ADMIN_EMAIL || registeredUsers.has(email)) return res.status(409).json({ error: "EMAIL_EXISTS", message: "Email đã được đăng ký." });
  if (db) {
    try { await db.query("INSERT INTO users (id, name, email, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?)", [id, name, email, user.role, credentials.salt, credentials.hash]); }
    catch (error) { return res.status(error.code === "ER_DUP_ENTRY" ? 409 : 503).json({ error: error.code === "ER_DUP_ENTRY" ? "EMAIL_EXISTS" : "DATABASE_UNAVAILABLE", message: error.code === "ER_DUP_ENTRY" ? "Email đã được đăng ký." : "Không thể tạo tài khoản." }); }
  } else {
    registeredUsers.set(email, { ...user, passwordSalt: credentials.salt, passwordHash: credentials.hash });
  }
  return res.status(201).json({ user: publicUser(user), message: "Đăng ký thành công. Bạn có thể đăng nhập." });
});

app.get("/api/users/me", authenticate, (req, res) => {
  if (!db) return res.status(200).json({ ...adminUser, token_expires_at: req.auth.exp });
  db.query("SELECT id, name, email, role FROM users WHERE id = ?", [req.auth.sub])
    .then(([rows]) => rows[0] ? res.status(200).json({ ...rows[0], token_expires_at: req.auth.exp }) : res.status(404).json({ error: "NOT_FOUND" }))
    .catch(() => res.status(503).json({ error: "DATABASE_UNAVAILABLE" }));
});

app.get("/api/users/:userId", authenticate, (req, res) => {
  if (!db) return res.status(200).json(adminUser);
  db.query("SELECT id, name, email, role FROM users WHERE id = ?", [req.params.userId])
    .then(([rows]) => rows[0] ? res.json(rows[0]) : res.status(404).json({ error: "NOT_FOUND" }))
    .catch(() => res.status(503).json({ error: "DATABASE_UNAVAILABLE" }));
});

app.use((err, _req, res, _next) => {
  console.error("[AUTH] Unhandled error:", err);
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Dịch vụ xác thực gặp lỗi." });
});

function startServer(port = PORT) {
  return app.listen(port, "0.0.0.0", () => {
    console.log(`[AUTH] Listening on port ${port}`);
    if (!process.env.ADMIN_PASSWORD) console.warn("[AUTH] Using the local demo password. Override ADMIN_PASSWORD outside local development.");
  });
}

if (require.main === module) initDatabase().then(() => startServer()).catch((error) => { console.error("[AUTH] Database initialization failed", error); process.exit(1); });

module.exports = { app, startServer };
