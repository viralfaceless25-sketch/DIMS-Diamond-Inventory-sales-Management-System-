const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertInventoryRequestMutation,
} = require('../src/services/requestAuthorization');

test('local request mutations require the supplying branch inventory', () => {
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: {
      cross_branch: false,
      fulfillment_branch: 'NY',
      branch: 'NY',
    },
    actorBranch: 'NY',
  }));

  assert.throws(
    () => assertInventoryRequestMutation({
      request: {
        cross_branch: false,
        fulfillment_branch: 'NY',
        branch: 'NY',
      },
      actorBranch: 'LA',
    }),
    /Only NY inventory/
  );
});

test('cross-branch request mutations retain route and status ownership', () => {
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: {
      cross_branch: true,
      fulfillment_branch: 'LA',
      delivery_branch: 'NY',
      delivery_route: 'internal_transfer',
      transfer_status: 'ready_for_rep',
    },
    actorBranch: 'NY',
  }));

  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: {
      cross_branch: true,
      fulfillment_branch: 'LA',
      delivery_branch: 'NY',
      delivery_route: 'customer_ship',
      transfer_status: 'packed',
    },
    actorBranch: 'LA',
  }));

  assert.throws(
    () => assertInventoryRequestMutation({
      request: {
        cross_branch: true,
        fulfillment_branch: 'LA',
        delivery_branch: 'NY',
        delivery_route: 'customer_ship',
        transfer_status: 'packed',
      },
      actorBranch: 'NY',
    }),
    /Only supplying inventory/
  );
});

test('cancelled requests cannot be mutated by any inventory branch', () => {
  assert.throws(() => assertInventoryRequestMutation({
    request: {
      status: 'cancelled',
      cross_branch: false,
      fulfillment_branch: 'NY',
      branch: 'NY',
    },
    actorBranch: 'NY',
  }), /cancelled request/);
});

test('destination inventory can record a return after handoff without reopening fulfillment', () => {
  const handed = {
    status: 'fulfilled',
    cross_branch: true,
    fulfillment_branch: 'LA',
    delivery_branch: 'NY',
    delivery_route: 'internal_transfer',
    transfer_status: 'handed_to_rep',
  };
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: handed,
    actorBranch: 'NY',
    mutationField: 'returned',
  }));
  assert.throws(() => assertInventoryRequestMutation({
    request: handed,
    actorBranch: 'NY',
    mutationField: 'stone_found',
  }), /ready for the sales rep/);
  assert.throws(() => assertInventoryRequestMutation({
    request: { ...handed, status: 'half_fulfilled' },
    actorBranch: 'NY',
    mutationField: 'returned',
  }), /completed request/);
});

test('local inventory can record a return only after the request is fulfilled', () => {
  const localRequest = {
    status: 'fulfilled',
    cross_branch: false,
    fulfillment_branch: 'NY',
    branch: 'NY',
  };
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: localRequest,
    actorBranch: 'NY',
    mutationField: 'returned',
  }));
  assert.throws(() => assertInventoryRequestMutation({
    request: { ...localRequest, status: 'half_fulfilled' },
    actorBranch: 'NY',
    mutationField: 'returned',
  }), /completed request/);
});
