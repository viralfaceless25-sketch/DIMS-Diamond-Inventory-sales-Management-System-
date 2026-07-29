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
