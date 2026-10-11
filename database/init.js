const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { Client } = require("pg");

const scrypt = promisify(crypto.scrypt);

function configuration(env = process.env) {
  for (const name of [
    "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
    "USER_DB_PASSWORD", "PRODUCT_DB_PASSWORD", "ORDER_DB_PASSWORD",
    "ADMIN_EMAIL", "ADMIN_PASSWORD",
  ]) {
    if (!env[name]?.trim() || env[name].startsWith("CHANGE_ME")) {
      throw new Error(`Set ${name} before initializing the database.`);
    }
  }
  const adminEmail = env.ADMIN_EMAIL.trim().toLowerCase();
  if (adminEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error("ADMIN_EMAIL must be a valid email address.");
  }
  return {
    connection: {
      host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME,
      user: env.DB_USER, password: env.DB_PASSWORD,
      connectionTimeoutMillis: 10000, ssl: false,
    },
    adminEmail,
    adminPassword: env.ADMIN_PASSWORD,
    roles: [
      { name: "nt548_user", table: "users", password: env.USER_DB_PASSWORD },
      { name: "nt548_product", table: "products", password: env.PRODUCT_DB_PASSWORD },
      { name: "nt548_order", table: "orders", password: env.ORDER_DB_PASSWORD },
    ],
  };
}

async function initialize(config, {
  migrationsDirectory = path.join(__dirname, "migrations"),
  log = console.log,
} = {}) {
  const files = (await fs.readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
  if (!files.length) throw new Error("No SQL migrations found.");

  const client = new Client(config.connection);
  await client.connect();
  try {
    await client.query("BEGIN");
    // Serializes initializers for this database until the transaction finishes.
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database()), 548)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDirectory, file), "utf8");
      // Git can convert line endings on Windows; this does not change the migration.
      const checksum = crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
      const previous = await client.query("SELECT checksum FROM schema_migrations WHERE version = $1", [file]);
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum) {
          throw new Error(`Migration ${file} changed after being applied. Add a new migration instead.`);
        }
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
      log(`[DB INIT] Applied ${file}`);
    }

    for (const role of config.roles) {
      const found = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role.name]);
      if (!found.rows.length) {
        const statement = await client.query("SELECT format('CREATE ROLE %I LOGIN', $1::text) AS sql", [role.name]);
        await client.query(statement.rows[0].sql);
      }
      // PostgreSQL DDL cannot bind a password with $1; quote it with server-side format.
      const statements = await client.query(`SELECT
        format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', $1::text, $2::text) AS password_sql,
        format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS connect_sql,
        format('GRANT USAGE ON SCHEMA public TO %I', $1::text) AS schema_sql,
        format('REVOKE ALL ON TABLE users, products, orders FROM %I', $1::text) AS revoke_sql,
        format('GRANT SELECT ON TABLE %I TO %I', $3::text, $1::text) AS select_sql`,
      [role.name, role.password, role.table]);
      for (const sql of Object.values(statements.rows[0])) await client.query(sql);
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const hash = (await scrypt(config.adminPassword, salt, 64)).toString("hex");
    const inserted = await client.query(`INSERT INTO users (id, name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, 'ADMIN')
      ON CONFLICT DO NOTHING RETURNING id`, [
      "usr_admin_001", "NT548 Administrator", config.adminEmail, `scrypt$${salt}$${hash}`,
    ]);
    await client.query("COMMIT");
    log(inserted.rowCount ? "[DB INIT] Initial admin created." : "[DB INIT] Existing users preserved; admin credentials were not overwritten.");
    log("[DB INIT] Ready. Backend roles can read their own tables.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  let config;
  try {
    config = configuration();
  } catch (error) {
    console.error(`[DB INIT] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    await initialize(config);
  } catch (error) {
    // Do not print connection objects, SQL or errors that might contain credentials.
    const migration = /^Migration \d+_[a-z0-9_]+\.sql changed/.test(error.message);
    console.error(migration ? `[DB INIT] ${error.message}` :
      "[DB INIT] Initialization failed. Check PostgreSQL connectivity, credentials and SQL migrations; no partial transaction was committed.");
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { configuration, initialize };
