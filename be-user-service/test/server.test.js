const { after, afterEach, before, beforeEach, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-jwt-secret-with-at-least-32-characters";

const pool = require("../db");
const { app } = require("../server");

let server;
let baseUrl;
let storedUser;
let queryMock;
const testPassword = "test-password";
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(testPassword, salt, 64).toString("hex");

async function login(email = "admin@nt548.local", password = testPassword) {
  return fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

async function getMe(token) {
  return fetch(`${baseUrl}/api/users/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

beforeEach(() => {
  storedUser = {
    id: "usr_test_admin",
    name: "Administrator from PostgreSQL",
    email: "admin@nt548.local",
    role: "ADMIN",
    is_active: true,
    password_hash: `scrypt$${salt}$${hash}`,
  };
  queryMock = mock.method(pool, "query", async (_sql, values) => {
    const matches = storedUser && storedUser.is_active &&
      (values[0] === storedUser.email || values[0] === storedUser.id);
    return { rows: matches ? [{ ...storedUser }] : [] };
  });
});

afterEach(() => {
  mock.restoreAll();
});

test("health endpoint is public", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, "auth-service");
  assert.equal(queryMock.mock.callCount(), 0);
});

test("missing credentials return 400 without querying the database", async () => {
  const response = await fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: storedUser.email }),
  });
  assert.equal(response.status, 400);
  assert.equal(queryMock.mock.callCount(), 0);
});

test("database login normalizes email and issues a token accepted by /me", async () => {
  const response = await login(" ADMIN@NT548.LOCAL ");
  assert.equal(response.status, 200);
  const { access_token: token, user } = await response.json();
  assert.ok(token);
  assert.deepEqual(user, {
    id: storedUser.id,
    name: storedUser.name,
    email: storedUser.email,
    role: storedUser.role,
  });
  assert.deepEqual(queryMock.mock.calls[0].arguments[1], [storedUser.email]);

  // /me must read the current DB row, not repeat the login response.
  storedUser.name = "Updated administrator";
  const me = await getMe(token);
  assert.equal(me.status, 200);
  const profile = await me.json();
  assert.equal(profile.name, storedUser.name);
  assert.equal(profile.email, storedUser.email);
  assert.ok(profile.token_expires_at > Date.now() / 1000);
  assert.equal("password_hash" in profile, false);
  assert.deepEqual(queryMock.mock.calls[1].arguments[1], [storedUser.id]);
});

test("wrong password returns 401", async () => {
  const response = await login(storedUser.email, "wrong-password");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "INVALID_CREDENTIALS");
});

test("unknown email returns 401", async () => {
  const response = await login("missing@nt548.local");
  assert.equal(response.status, 401);
});

test("inactive account cannot log in", async () => {
  storedUser.is_active = false;
  const response = await login();
  assert.equal(response.status, 401);
});

test("malformed stored hash is rejected", async () => {
  storedUser.password_hash = "not-a-valid-password-hash";
  const response = await login();
  assert.equal(response.status, 401);
});

test("/me requires a valid token without querying the database", async () => {
  const missingToken = await fetch(`${baseUrl}/api/users/me`);
  assert.equal(missingToken.status, 401);
  const invalidToken = await getMe("invalid-token");
  assert.equal(invalidToken.status, 401);
  assert.equal(queryMock.mock.callCount(), 0);
});

test("/me rejects an account disabled after login", async () => {
  const response = await login();
  const { access_token: token } = await response.json();
  storedUser.is_active = false;
  const me = await getMe(token);
  assert.equal(me.status, 401);
});

test("/me rejects an account deleted after login", async () => {
  const response = await login();
  const { access_token: token } = await response.json();
  storedUser = null;
  const me = await getMe(token);
  assert.equal(me.status, 401);
});

test("database failure returns 500 without leaking database details", async () => {
  queryMock.mock.mockImplementation(async () => {
    throw new Error("private-database-error");
  });
  mock.method(console, "error", () => {});
  const response = await login();
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "INTERNAL_ERROR");
  assert.equal(JSON.stringify(body).includes("private-database-error"), false);
});
