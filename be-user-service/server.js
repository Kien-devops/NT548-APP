const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = Number(process.env.PORT || 5001);
const JWT_SECRET = process.env.JWT_SECRET || "nt548-local-development-secret";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@nt548.local").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "nt548-demo";
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 3600);

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

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

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

  const candidateHash = crypto.scryptSync(password, passwordSalt, 64);
  const emailMatches = email === ADMIN_EMAIL;
  const passwordMatches = crypto.timingSafeEqual(candidateHash, passwordHash);

  if (!emailMatches || !passwordMatches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Email hoặc mật khẩu không chính xác." });
  }

  return res.status(200).json({
    access_token: createToken(adminUser),
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    user: adminUser,
  });
});

app.get("/api/users/me", authenticate, (req, res) => {
  res.status(200).json({ ...adminUser, token_expires_at: req.auth.exp });
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

if (require.main === module) startServer();

module.exports = { app, startServer };
