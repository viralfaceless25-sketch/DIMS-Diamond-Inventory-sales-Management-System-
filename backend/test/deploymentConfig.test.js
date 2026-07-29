const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Supabase uses standard certificate validation without a local CA file', () => {
  const { buildSslConfig, validateDatabaseConfig } = require('../src/db/databaseConfig');
  assert.deepEqual(buildSslConfig({ DATABASE_PROVIDER: 'supabase' }), { rejectUnauthorized: true });
  assert.doesNotThrow(() => validateDatabaseConfig({ NODE_ENV: 'production', DATABASE_PROVIDER: 'supabase' }));
});

test('production rejects unpinned unknown hosted databases', () => {
  const { validateDatabaseConfig } = require('../src/db/databaseConfig');
  assert.throws(
    () => validateDatabaseConfig({ NODE_ENV: 'production', DATABASE_PROVIDER: 'unknown' }),
    /DATABASE_SSL_CA_PATH/
  );
});

test('schema creates users before shipping labels reference users', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  assert.ok(schema.indexOf('CREATE TABLE IF NOT EXISTS users') < schema.indexOf('CREATE TABLE IF NOT EXISTS request_shipping_labels'));
});

test('schema keeps existing requests on the legacy document workflow', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  assert.match(
    schema,
    /ALTER TABLE requests ADD COLUMN IF NOT EXISTS workflow_version INTEGER NOT NULL DEFAULT 1/
  );
});

test('schema creates users before request paperwork references users', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  assert.ok(
    schema.indexOf('CREATE TABLE IF NOT EXISTS users')
      < schema.indexOf('CREATE TABLE IF NOT EXISTS request_paperwork_files')
  );
});

test('schema stores the delivery branch separately from the sales rep branch', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  assert.match(schema, /delivery_branch TEXT REFERENCES branches\(id\)/);
});
