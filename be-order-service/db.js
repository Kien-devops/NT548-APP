const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  ssl: false,
});

pool.on("error", (error) => {
  console.error("[ORDER DB] Idle connection error:", error.message);
});

module.exports = pool;
