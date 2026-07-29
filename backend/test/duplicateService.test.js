const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const {
  getHoldersMap,
  getHoldersForBarcodes,
} = require('../src/services/duplicateService');

function branchAwareQueryable(calls) {
  const held = {
    barcode: 'LA-001',
    request_id: 42,
    sales_rep_id: 7,
    rep_name: 'New York Rep',
    supply_branch: 'LA',
  };

  return {
    async query(sql, params) {
      calls.push({ sql, params });
      const requestedBranch = params.find((value) => ['NY', 'LA', 'CH'].includes(value));
      return { rows: requestedBranch === held.supply_branch ? [held] : [] };
    },
  };
}

test('holder maps are scoped to the supplying branch, not the rep branch', async (t) => {
  const originalQuery = pool.query;
  pool.query = async () => {
    throw new Error('getHoldersMap must use the injected queryable');
  };
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  const queryable = branchAwareQueryable(calls);

  const laHolders = await getHoldersMap('LA', queryable);
  const nyHolders = await getHoldersMap('NY', queryable);

  assert.equal(laHolders.get('LA-001')[0].repName, 'New York Rep');
  assert.equal(nyHolders.has('LA-001'), false);
  assert.match(calls[0].sql, /COALESCE\(r\.fulfillment_branch, r\.branch\)/);
  assert.match(calls[0].sql, /r\.status <> 'cancelled'/);
});

test('visible-page holder lookup uses the same supplying-branch scope', async () => {
  const calls = [];
  const holders = await getHoldersForBarcodes(
    'LA',
    ['LA-001', 'LA-001'],
    branchAwareQueryable(calls)
  );

  assert.equal(holders.get('LA-001')[0].requestId, 42);
  assert.deepEqual(calls[0].params[0], ['LA-001']);
  assert.match(calls[0].sql, /COALESCE\(r\.fulfillment_branch, r\.branch\)/);
  assert.match(calls[0].sql, /r\.status <> 'cancelled'/);
});
