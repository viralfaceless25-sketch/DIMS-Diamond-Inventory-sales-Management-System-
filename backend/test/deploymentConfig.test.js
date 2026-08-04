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

test('schema stores branch-scoped physical receipt events independently', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS shipment_receipts/);
  assert.match(schema, /receiving_branch\s+TEXT NOT NULL REFERENCES branches\(id\)/);
  assert.match(schema, /request_stone_id\s+INTEGER REFERENCES request_stones\(id\) ON DELETE SET NULL/);
  assert.match(schema, /received_on\s+DATE NOT NULL/);
  assert.match(schema, /corrected_by\s+INTEGER REFERENCES users\(id\)/);
  assert.match(schema, /CHECK \(stone_received OR cert_received\)/);
  assert.match(schema, /idx_shipment_receipts_unmatched/);
});

test('schema persists request notification lifecycle and explicit not-found resolution', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  assert.match(schema, /inventory_viewed_at TIMESTAMPTZ/);
  assert.match(schema, /inventory_viewed_by INTEGER REFERENCES users\(id\)/);
  assert.match(schema, /resolution_confirmed_at TIMESTAMPTZ/);
  assert.match(schema, /resolution_confirmed_by INTEGER REFERENCES users\(id\)/);
  assert.match(schema, /requested_by INTEGER REFERENCES users\(id\)/);
  assert.match(schema, /not_found\s+BOOLEAN NOT NULL DEFAULT false/);
  assert.match(schema, /not_found_at\s+TIMESTAMPTZ/);
  assert.match(schema, /not_found_by INTEGER REFERENCES users\(id\)/);
});
