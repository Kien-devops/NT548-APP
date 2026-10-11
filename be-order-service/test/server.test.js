const { after, afterEach, before, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.JWT_SECRET = "test-only-jwt-secret-with-at-least-32-characters";
const pool = require("../db");
const { app } = require("../server");

let server;
let baseUrl;
const databaseOrder = {
  order_id: "ORD-FROM-DATABASE",
  customer: "Database customer",
  total: "123.45",
  status: "PENDING",
};
const expectedOrder = { ...databaseOrder, total: 123.45 };

function token(expiresIn = 60) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: "test-user", exp: now + expiresIn });
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function get(path, accessToken = token()) {
  return fetch(`${baseUrl}${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => mock.restoreAll());

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("health endpoints are public and do not query the database", async () => {
  const query = mock.method(pool, "query", async () => { throw new Error("Unexpected database query"); });
  for (const path of ["/health", "/api/orders/health"]) {
    const response = await get(path, null);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, "order-service");
  }
  assert.equal(query.mock.callCount(), 0);
});

test("order list and detail require authentication before querying the database", async () => {
  const query = mock.method(pool, "query", async () => ({ rows: [] }));
  for (const path of ["/api/orders", "/api/orders/ORD-9021"]) {
    assert.equal((await get(path, null)).status, 401);
  }
  assert.equal(query.mock.callCount(), 0);
});

test("invalid and expired tokens are rejected before querying the database", async () => {
  const query = mock.method(pool, "query", async () => ({ rows: [] }));
  for (const accessToken of ["invalid-token", token(-60), token() + "tampered"]) {
    assert.equal((await get("/api/orders", accessToken)).status, 401);
  }
  assert.equal(query.mock.callCount(), 0);
});

test("list returns database orders with numeric totals", async () => {
  mock.method(pool, "query", async () => ({ rows: [databaseOrder] }));
  const response = await get("/api/orders");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [expectedOrder]);
});

test("empty database returns an empty list instead of demo orders", async () => {
  mock.method(pool, "query", async () => ({ rows: [] }));
  const response = await get("/api/orders");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("detail returns database data and passes the ID as a SQL parameter", async () => {
  const query = mock.method(pool, "query", async () => ({ rows: [databaseOrder] }));
  const response = await get(`/api/orders/${databaseOrder.order_id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expectedOrder);
  const [sql, parameters] = query.mock.calls[0].arguments;
  assert.match(sql, /WHERE order_id = \$1/);
  assert.deepEqual(parameters, [databaseOrder.order_id]);
});

test("untrusted order ID stays in the parameter rather than the SQL string", async () => {
  const query = mock.method(pool, "query", async () => ({ rows: [] }));
  const orderId = "' OR '1'='1";
  assert.equal((await get(`/api/orders/${encodeURIComponent(orderId)}`)).status, 404);
  const [sql, parameters] = query.mock.calls[0].arguments;
  assert.equal(sql.includes(orderId), false);
  assert.deepEqual(parameters, [orderId]);
});

test("missing order returns 404", async () => {
  mock.method(pool, "query", async () => ({ rows: [] }));
  const response = await get("/api/orders/missing");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "NOT_FOUND");
});

test("database failures return a generic error without connection details", async () => {
  mock.method(pool, "query", async () => { throw new Error("Private database connection details"); });
  mock.method(console, "error", () => {});
  for (const path of ["/api/orders", "/api/orders/ORD-9021"]) {
    const response = await get(path);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "INTERNAL_ERROR");
    assert.equal(JSON.stringify(body).includes("Private database"), false);
  }
});
