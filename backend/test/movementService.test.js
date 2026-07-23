const test = require('node:test');
const assert = require('node:assert/strict');
const {
  movementForStoneField,
  movementForTransferAction,
  movementLabel,
} = require('../src/services/movementService');

test('movement labels cover the request lifecycle', () => {
  assert.equal(movementLabel('requested'), 'Requested');
  assert.equal(movementLabel('erp_transfer_recorded'), 'ERP branch transfer recorded');
  assert.equal(movementLabel('branch_transfer_sent'), 'Branch transfer sent');
  assert.equal(movementLabel('branch_transfer_received'), 'Branch transfer received');
  assert.equal(movementLabel('returned'), 'Returned');
});

test('transfer actions map to movement events', () => {
  assert.equal(movementForTransferAction('pack'), 'packed_at_source');
  assert.equal(movementForTransferAction('ship'), 'branch_transfer_sent');
  assert.equal(movementForTransferAction('receive'), 'branch_transfer_received');
  assert.equal(movementForTransferAction('ready'), 'ready_for_rep');
  assert.equal(movementForTransferAction('hand_to_rep'), 'handed_to_rep');
  assert.equal(movementForTransferAction('ship_customer'), 'shipped_to_customer');
  assert.equal(movementForTransferAction('dropoff_customer'), 'dropped_off_to_customer');
});

test('stone checkbox fields map to movement events', () => {
  assert.equal(movementForStoneField('stone_found'), 'stone_confirmed');
  assert.equal(movementForStoneField('cert_found'), 'certificate_confirmed');
  assert.equal(movementForStoneField('returned'), 'returned');
  assert.equal(movementForStoneField('unknown'), null);
});
