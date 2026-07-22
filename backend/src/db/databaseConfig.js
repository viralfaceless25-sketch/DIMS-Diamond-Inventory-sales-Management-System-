const fs = require('fs');

function buildSslConfig(env = process.env) {
  if (env.DATABASE_SSL === 'false') return false;
  if (env.DATABASE_SSL_CA_PATH) {
    return { ca: fs.readFileSync(env.DATABASE_SSL_CA_PATH, 'utf8'), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}

function validateDatabaseConfig(env = process.env) {
  const provider = String(env.DATABASE_PROVIDER || '').toLowerCase();
  const isProduction = env.NODE_ENV === 'production';
  const sslDisabled = env.DATABASE_SSL === 'false';
  const hasPinnedCa = Boolean(env.DATABASE_SSL_CA_PATH);

  if (isProduction && sslDisabled) {
    throw new Error('Refusing to start production with DATABASE_SSL=false');
  }
  if (isProduction && !hasPinnedCa && provider !== 'supabase') {
    throw new Error('Refusing to start in production without DATABASE_SSL_CA_PATH. Set DATABASE_PROVIDER=supabase for Supabase, or configure a pinned CA for another provider.');
  }
}

module.exports = { buildSslConfig, validateDatabaseConfig };
