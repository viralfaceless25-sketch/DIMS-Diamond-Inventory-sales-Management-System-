// Makes the Supabase target the live backend database after a verified copy.
// A dated source configuration backup is written before any change.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '..', '.env');
const stamp = new Date().toISOString().slice(0, 10);
const backupPath = path.join(__dirname, '..', '..', `.env.cockroach-backup-${stamp}`);

function replaceSetting(content, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = `${key}=${value}`;
  const matcher = new RegExp(`^${escapedKey}=.*$`, 'm');
  return matcher.test(content) ? content.replace(matcher, line) : `${content.trimEnd()}\n${line}\n`;
}

function switchToSupabase() {
  if (!process.env.SUPABASE_DATABASE_URL || !process.env.SUPABASE_DATABASE_SSL_CA_PATH) {
    throw new Error('SUPABASE_DATABASE_URL and SUPABASE_DATABASE_SSL_CA_PATH are required.');
  }
  const current = fs.readFileSync(envPath, 'utf8');
  const sourceUrl = process.env.DATABASE_URL;
  const sourceCaPath = process.env.DATABASE_SSL_CA_PATH || '';
  if (!sourceUrl) throw new Error('DATABASE_URL is missing from .env.');
  if (!fs.existsSync(backupPath)) fs.copyFileSync(envPath, backupPath);

  let next = current;
  next = replaceSetting(next, 'SOURCE_DATABASE_URL', sourceUrl);
  next = replaceSetting(next, 'SOURCE_DATABASE_SSL_CA_PATH', sourceCaPath);
  next = replaceSetting(next, 'DATABASE_URL', process.env.SUPABASE_DATABASE_URL);
  next = replaceSetting(next, 'DATABASE_SSL', 'true');
  next = replaceSetting(next, 'DATABASE_SSL_CA_PATH', process.env.SUPABASE_DATABASE_SSL_CA_PATH);
  next = replaceSetting(next, 'DATABASE_PROVIDER', 'supabase');
  fs.writeFileSync(envPath, next, 'utf8');
  console.log(`Live database switched to Supabase. Rollback config: ${backupPath}`);
}

try {
  switchToSupabase();
} catch (err) {
  console.error(`Supabase switch failed: ${err.message}`);
  process.exit(1);
}
