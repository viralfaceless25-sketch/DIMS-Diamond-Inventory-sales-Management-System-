const fs = require('fs');
const { Pool } = require('pg');

const COPY_TABLES = [
  'branches', 'sales_reps', 'loose_diamonds', 'jewelry_pieces', 'users',
  'requests', 'request_stones', 'request_shipping_labels', 'audit_log',
];
const ID_TABLES = ['sales_reps', 'users', 'requests', 'request_stones', 'audit_log'];

function quote(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function assertEmptyTarget(counts, allowNonempty) {
  if (allowNonempty) return;
  const occupied = Object.entries(counts)
    .filter(([table, count]) => table !== 'branches' && Number(count) > 0)
    .map(([table, count]) => `${table} (${count})`);
  if (occupied.length) throw new Error(`Supabase target is not empty: ${occupied.join(', ')}`);
}

function verifyCounts(sourceCounts, targetCounts) {
  const mismatches = Object.keys(sourceCounts)
    .filter((table) => Number(sourceCounts[table]) !== Number(targetCounts[table]))
    .map((table) => `${table}: source ${sourceCounts[table]}, target ${targetCounts[table]}`);
  if (mismatches.length) throw new Error(`Copy verification failed: ${mismatches.join('; ')}`);
}

async function tableCounts(pool) {
  const counts = {};
  for (const table of COPY_TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM ${quote(table)}`);
    counts[table] = rows[0].count;
  }
  return counts;
}

async function copyTable(source, target, table) {
  const { rows } = await source.query(`SELECT * FROM ${quote(table)}`);
  if (!rows.length) return 0;
  const columns = Object.keys(rows[0]);
  const columnSql = columns.map(quote).join(', ');
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        values.push(row[column]);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const conflict = table === 'branches' ? ' ON CONFLICT (id) DO NOTHING' : '';
    await target.query(`INSERT INTO ${quote(table)} (${columnSql}) VALUES ${tuples.join(', ')}${conflict}`, values);
  }
  return rows.length;
}

async function resetSequences(target) {
  for (const table of ID_TABLES) {
    await target.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${quote(table)}), 1), EXISTS(SELECT 1 FROM ${quote(table)}))`,
      [table]
    );
  }
}

function createPool(connectionString, caPath) {
  return new Pool({
    connectionString,
    ssl: caPath ? { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: true },
  });
}

async function runCopy(env = process.env) {
  // The live database already uses DATABASE_URL. SOURCE_DATABASE_URL remains
  // available for an explicit source override during one-time migrations.
  const sourceDatabaseUrl = env.SOURCE_DATABASE_URL || env.DATABASE_URL;
  if (!sourceDatabaseUrl || !env.SUPABASE_DATABASE_URL) {
    throw new Error('DATABASE_URL (or SOURCE_DATABASE_URL) and SUPABASE_DATABASE_URL are required');
  }
  const source = createPool(sourceDatabaseUrl, env.SOURCE_DATABASE_SSL_CA_PATH || env.DATABASE_SSL_CA_PATH);
  const target = createPool(env.SUPABASE_DATABASE_URL, env.SUPABASE_DATABASE_SSL_CA_PATH);
  try {
    const sourceCounts = await tableCounts(source);
    if (env.DRY_RUN === 'true') return { dryRun: true, sourceCounts };

    assertEmptyTarget(await tableCounts(target), env.ALLOW_NONEMPTY_TARGET === 'true');
    const client = await target.connect();
    try {
      await client.query('BEGIN');
      for (const table of COPY_TABLES) await copyTable(source, client, table);
      await resetSequences(client);
      const targetCounts = await tableCounts(client);
      verifyCounts(sourceCounts, targetCounts);
      await client.query('COMMIT');
      return { dryRun: false, sourceCounts, targetCounts };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

if (require.main === module) {
  require('dotenv').config();
  runCopy().then((result) => console.log(JSON.stringify(result, null, 2))).catch((err) => {
    console.error(`Supabase copy failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { COPY_TABLES, assertEmptyTarget, verifyCounts, runCopy };
