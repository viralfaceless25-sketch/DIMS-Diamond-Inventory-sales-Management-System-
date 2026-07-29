const test = require('node:test');
const assert = require('node:assert/strict');
const { getTransferAction } = require('../src/services/transferService');

test('only the supplying branch can pack an internal transfer', () => {
  assert.equal(getTransferAction({ route: 'internal_transfer', status: 'awaiting_source', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'LA', action: 'pack', erpTransferConfirmed: true }), 'packed');
  assert.throws(() => getTransferAction({ route: 'internal_transfer', status: 'awaiting_source', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'NY', action: 'pack', erpTransferConfirmed: true }), /supplying branch/);
});

test('cross-branch packing requires ERP transfer confirmation', () => {
  assert.throws(
    () => getTransferAction({
      route: 'internal_transfer',
      status: 'awaiting_source',
      sourceBranch: 'LA',
      destinationBranch: 'NY',
      actorBranch: 'LA',
      action: 'pack',
      requiresErpTransfer: true,
      erpTransferConfirmed: false,
    }),
    /ERP branch transfer/
  );
});

test('local customer shipping can be packed without an ERP branch transfer', () => {
  assert.equal(
    getTransferAction({
      route: 'customer_ship',
      status: 'awaiting_source',
      sourceBranch: 'NY',
      destinationBranch: 'NY',
      actorBranch: 'NY',
      action: 'pack',
      requiresErpTransfer: false,
      erpTransferConfirmed: false,
    }),
    'packed'
  );
});

test('an internal transfer reaches the rep only in strict branch order', () => {
  assert.equal(getTransferAction({ route: 'internal_transfer', status: 'packed', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'LA', action: 'ship' }), 'shipped_to_destination');
  assert.equal(getTransferAction({ route: 'internal_transfer', status: 'shipped_to_destination', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'NY', action: 'receive' }), 'received_at_destination');
  assert.throws(() => getTransferAction({ route: 'internal_transfer', status: 'packed', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'NY', action: 'receive' }), /not allowed/);
});

test('physical office movement does not wait for destination ERP BT receipt', () => {
  assert.equal(getTransferAction({
    route: 'internal_transfer',
    status: 'awaiting_source',
    sourceBranch: 'LA',
    destinationBranch: 'NY',
    actorBranch: 'LA',
    action: 'pack',
    requiresErpTransfer: true,
    erpTransferConfirmed: true,
    erpTransferReceived: false,
  }), 'packed');
});

test('direct customer shipment requires the supplying branch and a label', () => {
  assert.throws(() => getTransferAction({ route: 'customer_ship', status: 'packed', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'LA', action: 'ship_customer', hasLabel: false }), /shipping label/);
  assert.throws(() => getTransferAction({ route: 'customer_ship', status: 'packed', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'LA', action: 'ship_customer', hasLabel: true, paperworkType: 'pending' }), /paperwork decision/);
  assert.equal(getTransferAction({ route: 'customer_ship', status: 'packed', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'LA', action: 'ship_customer', hasLabel: true, paperworkType: 'none' }), 'shipped_to_customer');
  assert.equal(getTransferAction({ route: 'customer_ship', status: 'packed', sourceBranch: 'LA', destinationBranch: 'NY', actorBranch: 'LA', action: 'ship_customer', hasLabel: true, paperworkType: 'invoice' }), 'shipped_to_customer');
});
