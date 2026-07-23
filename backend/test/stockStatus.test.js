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

test('only available stock is requestable', () => {
  assert.equal(isRequestableStockStatus('Available'), true);
  for (const status of ['on_memo', 'on_hold', 'in_transit']) {
    assert.equal(isRequestableStockStatus(status), false);
  }
});
