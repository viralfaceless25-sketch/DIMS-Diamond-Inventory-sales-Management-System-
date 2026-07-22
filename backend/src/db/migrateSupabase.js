// Applies the schema to the configured Supabase target without changing the
// active DATABASE_URL used by the live office application.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.SUPABASE_DATABASE_URL;
const caPath = process.env.SUPABASE_DATABASE_SSL_CA_PATH;

if (!connectionString || !caPath) {
  throw new Error('SUPABASE_DATABASE_URL and SUPABASE_DATABASE_SSL_CA_PATH are required.');
}

const pool = new Pool({
  connectionString,
  ssl: { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true },
});

async function migrateSupabase() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema.sql to Supabase ...');
  await pool.query(schema);
  console.log('Supabase schema applied successfully.');
  await pool.end();
}

migrateSupabase().catch(async (err) => {
  console.error('Supabase schema migration failed:', err.message);
  await pool.end();
  process.exit(1);
});
