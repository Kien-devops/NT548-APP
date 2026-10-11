const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");
const { configuration, initialize } = require("../init");

const config = configuration();
// Never run these mutation tests against the application's database.
assert.match(config.connection.database, /^nt548_bootstrap_test_[0-9]+$/);
// Roles are cluster-wide, so tests use distinct names as well as a separate DB.
const suffix = config.connection.database.match(/[0-9]+$/)[0];
config.roles = config.roles.map((role) => ({ ...role, name: `${role.name}_test_${suffix}` }));
const admin = new Client(config.connection);
const quiet = { log: () => {} };

before(async () => {
  await admin.connect();
  await initialize(config, quiet);
});

after(async () => {
  try {
    for (const role of config.roles) {
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role.name]);
      if (!exists.rows.length) continue;
      const commands = await admin.query(`SELECT
        format('DROP OWNED BY %I', $1::text) AS owned_sql,
        format('DROP ROLE %I', $1::text) AS role_sql`, [role.name]);
      await admin.query(commands.rows[0].owned_sql);
      await admin.query(commands.rows[0].role_sql);
    }
  } finally {
    await admin.end();
  }
});

test("configuration rejects placeholder secrets and invalid admin email", () => {
  assert.throws(() => configuration({ ...process.env, ADMIN_PASSWORD: "CHANGE_ME_PASSWORD" }), /Set ADMIN_PASSWORD/);
  assert.throws(() => configuration({ ...process.env, ADMIN_EMAIL: "invalid" }), /valid email/);
});

test("fresh database has migrations, demo data and a usable scrypt admin", async () => {
  const migrations = await admin.query("SELECT COUNT(*)::int AS count FROM schema_migrations");
  assert.equal(migrations.rows[0].count, 3);
  const counts = await admin.query(`SELECT
    (SELECT COUNT(*)::int FROM products) AS products,
    (SELECT COUNT(*)::int FROM orders) AS orders,
    (SELECT COUNT(*)::int FROM users) AS users`);
  assert.deepEqual(counts.rows[0], { products: 4, orders: 3, users: 1 });
  const user = (await admin.query("SELECT * FROM users WHERE id = 'usr_admin_001'")).rows[0];
  assert.equal(user.email, config.adminEmail);
  assert.equal(user.role, "ADMIN");
  assert.equal(user.is_active, true);
  const parts = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(user.password_hash);
  assert.ok(parts, "Seed hash must match the User Backend format");
  const expected = Buffer.from(parts[2], "hex");
  assert.ok(crypto.timingSafeEqual(crypto.scryptSync(config.adminPassword, parts[1], 64), expected));
  assert.ok(!crypto.timingSafeEqual(crypto.scryptSync(config.adminPassword + "wrong", parts[1], 64), expected));
});

test("each backend role can authenticate and read only its own application table", async () => {
  for (const role of config.roles) {
    const client = new Client({ ...config.connection, user: role.name, password: role.password });
    await client.connect();
    try {
      const rows = await client.query(`SELECT COUNT(*)::int AS count FROM ${role.table}`);
      assert.ok(rows.rows[0].count > 0);
      for (const table of ["users", "products", "orders"].filter((name) => name !== role.table)) {
        await assert.rejects(client.query(`SELECT 1 FROM ${table}`), (error) => error.code === "42501");
      }
      const privileges = await client.query(`SELECT
        has_table_privilege(current_user, $1, 'INSERT') AS can_insert,
        has_table_privilege(current_user, $1, 'UPDATE') AS can_update,
        has_table_privilege(current_user, $1, 'DELETE') AS can_delete`, [role.table]);
      assert.deepEqual(privileges.rows[0], { can_insert: false, can_update: false, can_delete: false });
    } finally {
      await client.end();
    }
  }
});

test("rerunning preserves edited data, existing admin and migration history", async () => {
  const original = (await admin.query("SELECT password_hash FROM users WHERE id = 'usr_admin_001'")).rows[0].password_hash;
  await admin.query("UPDATE products SET name = 'Edited product' WHERE id = 101");
  await admin.query("UPDATE orders SET customer = 'Edited customer' WHERE order_id = 'ORD-9021'");
  await initialize({ ...config, adminPassword: config.adminPassword + "changed" }, quiet);
  const user = (await admin.query("SELECT password_hash FROM users WHERE id = 'usr_admin_001'")).rows[0];
  assert.ok(user.password_hash === original, "Existing admin password must not be reset");
  assert.equal((await admin.query("SELECT name FROM products WHERE id = 101")).rows[0].name, "Edited product");
  assert.equal((await admin.query("SELECT customer FROM orders WHERE order_id = 'ORD-9021'")).rows[0].customer, "Edited customer");
  assert.equal((await admin.query("SELECT COUNT(*)::int AS count FROM schema_migrations")).rows[0].count, 3);
});

test("editing an applied migration is rejected", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nt548-migration-check-"));
  try {
    const file = "001_products.sql";
    const original = await fs.readFile(path.join(__dirname, "../migrations", file), "utf8");
    await fs.writeFile(path.join(folder, file), original + "\n-- changed after application\n");
    await assert.rejects(initialize(config, { ...quiet, migrationsDirectory: folder }), /changed after being applied/);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("a failing migration rolls back earlier work in the same run", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nt548-migration-rollback-"));
  try {
    await fs.writeFile(path.join(folder, "900_probe.sql"), "CREATE TABLE bootstrap_rollback_probe (id INTEGER);");
    await fs.writeFile(path.join(folder, "901_broken.sql"), "THIS IS NOT VALID SQL;");
    await assert.rejects(initialize(config, { ...quiet, migrationsDirectory: folder }), (error) => error.code === "42601");
    assert.equal((await admin.query("SELECT to_regclass('public.bootstrap_rollback_probe') AS table_name")).rows[0].table_name, null);
    assert.equal((await admin.query("SELECT COUNT(*)::int AS count FROM schema_migrations WHERE version = '900_probe.sql'")).rows[0].count, 0);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
