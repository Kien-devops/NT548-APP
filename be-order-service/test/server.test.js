const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.JWT_SECRET = "test-only-jwt-secret-with-at-least-32-characters";
const { app } = require("../server");

let server;
let baseUrl;

function token() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: "test-user", exp: now + 60 });
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("health endpoint is public", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
});

test("orders require auth and return data with a valid token", async () => {
  assert.equal((await fetch(`${baseUrl}/api/orders`)).status, 401);
  const response = await fetch(`${baseUrl}/api/orders`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).length > 0);
});
