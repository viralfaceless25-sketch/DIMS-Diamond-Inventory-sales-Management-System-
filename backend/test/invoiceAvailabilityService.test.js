const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeInvoiceWithInventory } = require('../src/services/invoiceAvailabilityService');

const parsed = [
  {
    barcode: 'LA-100',
    shape: 'Round',
    carat: 1.2,
    color: 'D',
    clarity: 'VS1',
    certificate_no: 'C-100',
    item_type: 'loose',
    confidence: 'high',
  },
];

test('invoice extraction keeps available stock requestable across branches', () => {
  const [stone] = mergeInvoiceWithInventory(parsed, [{
    barcode: 'LA-100',
    branch: 'LA',
    stock_status: 'available',
    snapshot_active: true,
    item_type: 'loose',
    carat: '1.20',
    cost: '2500',
  }]);

  assert.equal(stone.available, true);
  assert.equal(stone.stockBranch, 'LA');
  assert.equal(stone.branch, 'LA');
  assert.equal(stone.source, 'inventory');
  assert.equal(stone.carat, 1.2);
  assert.equal('cost' in stone, false);
});

test('invoice extraction blocks live snapshot statuses and archived rows precisely', () => {
  const [held] = mergeInvoiceWithInventory(parsed, [{
    barcode: 'LA-100',
    branch: 'LA',
    stock_status: 'on_hold',
    snapshot_active: true,
    item_type: 'loose',
  }]);
  assert.equal(held.available, false);
  assert.equal(held.reason, 'on_hold');
  assert.equal(held.availabilityLabel, 'On Hold');
  assert.equal(held.stockBranch, 'LA');

  const [missing] = mergeInvoiceWithInventory(parsed, [{
    barcode: 'LA-100',
    branch: 'LA',
    stock_status: 'available',
    snapshot_active: false,
    item_type: 'loose',
  }]);
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'not_in_snapshot');
  assert.equal(missing.availabilityLabel, 'Not in latest ERP snapshot');
});

test('invoice extraction labels barcodes absent from preserved inventory', () => {
  const [stone] = mergeInvoiceWithInventory(parsed, []);
  assert.equal(stone.available, false);
  assert.equal(stone.reason, 'not_in_stock');
  assert.equal(stone.stockBranch, null);
});
