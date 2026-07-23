const test = require('node:test');
const assert = require('node:assert/strict');
const { COPY_TABLES, assertEmptyTarget, verifyCounts } = require('../src/db/copyToSupabase');

test('copy order respects the application foreign keys', () => {
  assert.ok(COPY_TABLES.indexOf('branches') < COPY_TABLES.indexOf('sales_reps'));
  assert.ok(COPY_TABLES.indexOf('sales_reps') < COPY_TABLES.indexOf('users'));
  assert.ok(COPY_TABLES.indexOf('users') < COPY_TABLES.indexOf('request_shipping_labels'));
  assert.ok(COPY_TABLES.indexOf('requests') < COPY_TABLES.indexOf('request_stones'));
  assert.ok(COPY_TABLES.indexOf('request_stones') < COPY_TABLES.indexOf('stone_movements'));
  assert.ok(COPY_TABLES.indexOf('users') < COPY_TABLES.indexOf('stone_movements'));
});

test('target copy refuses existing application data by default', () => {
  assert.throws(() => assertEmptyTarget({ requests: 1 }, false), /not empty/);
  assert.doesNotThrow(() => assertEmptyTarget({ requests: 0, users: 0 }, false));
  assert.doesNotThrow(() => assertEmptyTarget({ requests: 1 }, true));
});

test('count verification names every mismatched table', () => {
  assert.throws(() => verifyCounts({ users: 4, requests: 7 }, { users: 4, requests: 6 }), /requests: source 7, target 6/);
  assert.doesNotThrow(() => verifyCounts({ users: 4 }, { users: 4 }));
});
