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

test('invoice extraction keeps On Hold / On Memo / In Transit requestable but still labeled', () => {
  const [held] = mergeInvoiceWithInventory(parsed, [{
    barcode: 'LA-100',
    branch: 'LA',
    stock_status: 'on_hold',
    snapshot_active: true,
    item_type: 'loose',
  }]);
  assert.equal(held.available, true);
  assert.equal(held.availabilityLabel, 'On Hold');
  assert.equal(held.stockBranch, 'LA');

  const [onMemo] = mergeInvoiceWithInventory(parsed, [{
    barcode: 'LA-100',
    branch: 'LA',
    stock_status: 'on_memo',
    snapshot_active: true,
    item_type: 'loose',
  }]);
  assert.equal(onMemo.available, true);
  assert.equal(onMemo.availabilityLabel, 'On Memo');

  const [inTransit] = mergeInvoiceWithInventory(parsed, [{
    barcode: 'LA-100',
    branch: 'LA',
    stock_status: 'in_transit',
    snapshot_active: true,
    item_type: 'loose',
  }]);
  assert.equal(inTransit.available, true);
  assert.equal(inTransit.availabilityLabel, 'In Transit');
});

test('invoice extraction blocks rows archived out of the latest snapshot', () => {
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
