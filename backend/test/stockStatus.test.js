const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStockStatus,
  stockStatusLabel,
  isRequestableStockStatus,
} = require('../src/services/stockStatus');

test('normalizes current and future ERP status aliases', () => {
  assert.equal(normalizeStockStatus('Available'), 'available');
  assert.equal(normalizeStockStatus('In Stock'), 'available');
  assert.equal(normalizeStockStatus('InStock'), 'available');
  assert.equal(normalizeStockStatus('On Memo'), 'on_memo');
  assert.equal(normalizeStockStatus('OnMemo'), 'on_memo');
  assert.equal(normalizeStockStatus('On Hold'), 'on_hold');
  assert.equal(normalizeStockStatus('OnHold'), 'on_hold');
  assert.equal(normalizeStockStatus('In Transit'), 'in_transit');
  assert.equal(normalizeStockStatus('InTransit'), 'in_transit');
});

test('labels every canonical ERP stock status', () => {
  assert.equal(stockStatusLabel('available'), 'Available');
  assert.equal(stockStatusLabel('on_memo'), 'On Memo');
  assert.equal(stockStatusLabel('on_hold'), 'On Hold');
  assert.equal(stockStatusLabel('in_transit'), 'In Transit');
});

test('every known snapshot status is requestable — none of them alone blocks a request', () => {
  // Available / On Hold / On Memo / In Transit all come from the daily Excel
  // snapshot and can go stale before the next import, so none blocks by
  // itself. A stone missing from the snapshot entirely (checked separately
  // via snapshot_active, not stock_status) still blocks.
  for (const status of ['Available', 'on_memo', 'on_hold', 'in_transit', 'On Hold', 'OnMemo']) {
    assert.equal(isRequestableStockStatus(status), true, `expected ${status} to be requestable`);
  }
});
