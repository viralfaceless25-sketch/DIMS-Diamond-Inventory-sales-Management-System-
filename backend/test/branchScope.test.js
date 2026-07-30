const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inventoryBranchScope } = require('../src/services/branchScope');

test('pins an inventory query to the user own branch', () => {
  assert.equal(inventoryBranchScope('NY'), 'NY');
  assert.equal(inventoryBranchScope('LA'), 'LA');
  assert.equal(inventoryBranchScope('CH'), 'CH');
});

test('normalizes case and surrounding whitespace', () => {
  assert.equal(inventoryBranchScope('  ny '), 'NY');
  assert.equal(inventoryBranchScope('la'), 'LA');
});

test('never widens to ALL or an unknown branch', () => {
  for (const value of ['ALL', 'all', '', null, undefined, 'SURAT', 'NYC']) {
    assert.throws(
      () => inventoryBranchScope(value),
      (error) => error.status === 403 && /missing a valid branch/.test(error.message),
      `expected ${JSON.stringify(value)} to be rejected`
    );
  }
});

// Lock the routes shut: an inventory room must be scoped by its authenticated
// branch, not by a client-supplied branch/ALL value. These assertions fail if
// anyone reintroduces the `branch !== 'ALL'` bypass on the inventory queues.
test('requests routes scope inventory reads by the authenticated branch', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/routes/requests.js'),
    'utf8'
  );
  assert.match(source, /inventoryBranchScope\(req\.user\.branch\)/);
  assert.doesNotMatch(source, /branch !== 'ALL'/);
});

test('tracking route scopes inventory reads by the authenticated branch', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/routes/tracking.js'),
    'utf8'
  );
  assert.match(source, /inventoryBranchScope\(req\.user\.branch\)/);
  assert.doesNotMatch(source, /branch !== 'ALL'/);
});
