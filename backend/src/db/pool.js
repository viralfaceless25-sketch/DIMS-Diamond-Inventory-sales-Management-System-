const { Pool } = require('pg');
const { buildSslConfig, validateDatabaseConfig } = require('./databaseConfig');

validateDatabaseConfig();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
  max: Number(process.env.DATABASE_POOL_MAX || 5),
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error', err);
});

module.exports = pool;
