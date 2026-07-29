const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorizeLockedRequestStock,
  normalizeRequestedStones,
  loadLockedRequestStock,
  validateRequestStock,
} = require('../src/services/requestStockService');

test('request normalization enforces count, uniqueness, and barcode length', () => {
  assert.throws(
    () => normalizeRequestedStones(Array.from({ length: 51 }, (_, index) => ({
      barcode: `NY-${index}`,
      itemType: 'loose',
    }))),
    /maximum of 50/
  );
  assert.throws(
    () => normalizeRequestedStones([{ barcode: 'X'.repeat(65), itemType: 'loose' }]),
    /64 characters/
  );
  assert.deepEqual(
    normalizeRequestedStones([
      { barcode: ' la-001 ', itemType: 'loose' },
      { barcode: 'LA-001', itemType: 'loose' },
      { barcode: 'ring-1', itemType: 'jewelry' },
    ]),
    [
      { barcode: 'LA-001', itemType: 'loose' },
      { barcode: 'RING-1', itemType: 'jewelry' },
    ]
  );
});

test('stock is locked in deterministic loose-then-jewelry order', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('loose_diamonds')) {
        return {
          rows: [{
            barcode: 'L-1',
            branch: 'LA',
            stock_status: 'available',
            item_type: 'loose',
          }],
        };
      }
      return {
        rows: [{
          barcode: 'J-1',
          branch: 'LA',
          stock_status: 'available',
          item_type: 'jewelry',
        }],
      };
    },
  };

  const stock = await loadLockedRequestStock(client, [
    { barcode: 'J-1', itemType: 'jewelry' },
    { barcode: 'L-1', itemType: 'loose' },
  ]);

  assert.deepEqual(calls.map((call) => (
    call.sql.includes('loose_diamonds') ? 'loose' : 'jewelry'
  )), ['loose', 'jewelry']);
  assert.match(calls[0].sql, /ORDER BY barcode FOR UPDATE/);
  assert.match(calls[1].sql, /ORDER BY barcode FOR UPDATE/);
  assert.equal(stock.get('loose:L-1').branch, 'LA');
  assert.equal(stock.get('jewelry:J-1').branch, 'LA');
});

test('locked stock validation blocks missing and unavailable items', () => {
  const stock = new Map([
    ['loose:MEMO-1', {
      barcode: 'MEMO-1',
      branch: 'LA',
      stock_status: 'on_memo',
      item_type: 'loose',
    }],
  ]);

  assert.throws(
    () => validateRequestStock([
      { barcode: 'MEMO-1', itemType: 'loose' },
      { barcode: 'MISSING', itemType: 'jewelry' },
    ], stock),
    (error) => error.status === 409
      && error.blocked.some((reason) => reason.includes('On Memo'))
      && error.blocked.some((reason) => reason.includes('not in stock'))
  );
});

test('a row archived from the latest ERP snapshot is not requestable', () => {
  const stock = new Map([
    ['loose:ARCHIVED-1', {
      barcode: 'ARCHIVED-1',
      branch: 'LA',
      stock_status: 'available',
      snapshot_active: false,
      item_type: 'loose',
    }],
  ]);

  assert.throws(
    () => validateRequestStock([
      { barcode: 'ARCHIVED-1', itemType: 'loose' },
    ], stock),
    (error) => error.status === 409
      && error.blocked.includes('ARCHIVED-1 is Not in latest ERP snapshot')
  );
});

test('a newer one-time home-branch verification permits stale blocked stock', () => {
  const stones = [{ barcode: 'LA-100', itemType: 'loose' }];
  const stockByKey = new Map([['loose:LA-100', {
    barcode: 'LA-100',
    item_type: 'loose',
    branch: 'LA',
    stock_status: 'on_hold',
    snapshot_active: true,
    last_seen_at: '2026-07-29T08:00:00.000Z',
  }]]);
  const authorizationsByKey = new Map([['loose:LA-100', {
    id: 91,
    sales_rep_id: 7,
    barcode: 'LA-100',
    item_type: 'loose',
    home_branch: 'LA',
    state: 'verified_available',
    verified_status: 'available',
    verified_at: '2026-07-29T11:00:00.000Z',
    consumed_at: null,
  }]]);

  assert.deepEqual(
    validateRequestStock(stones, stockByKey, {
      authorizationsByKey,
      salesRepId: 7,
    }),
    [91]
  );
  assert.throws(
    () => validateRequestStock(stones, stockByKey, {
      authorizationsByKey,
      salesRepId: 8,
    }),
    /LA-100 is On Hold/
  );
});

test('request preparation locks stock before the one-time verification', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM loose_diamonds')) {
        return { rows: [{
          barcode: 'LA-100',
          item_type: 'loose',
          branch: 'LA',
          stock_status: 'on_hold',
          snapshot_active: true,
          last_seen_at: '2026-07-29T08:00:00.000Z',
        }] };
      }
      if (sql.includes('FROM stock_recheck_requests')) {
        return { rows: [{
          id: 91,
          sales_rep_id: 7,
          barcode: 'LA-100',
          item_type: 'loose',
          home_branch: 'LA',
          state: 'verified_available',
          verified_status: 'available',
          verified_at: '2026-07-29T11:00:00.000Z',
          consumed_at: null,
        }] };
      }
      return { rows: [] };
    },
  };

  const result = await authorizeLockedRequestStock(
    client,
    [{ barcode: 'LA-100', itemType: 'loose' }],
    7
  );

  assert.equal(calls[0].includes('FROM loose_diamonds'), true);
  assert.equal(calls[1].includes('FROM stock_recheck_requests'), true);
  assert.equal(result.stockByKey.get('loose:LA-100').branch, 'LA');
  assert.deepEqual(result.authorizationIds, [91]);
});
