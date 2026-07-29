const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
