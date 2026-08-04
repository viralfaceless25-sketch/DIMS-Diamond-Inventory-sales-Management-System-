const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertInventoryRequestRead,
  assertInventoryRequestMutation,
  assertResolutionFieldApplies,
} = require('../src/services/requestAuthorization');

test('inventory detail reads are limited to participating branches', () => {
  const request = {
    branch: 'LA',
    fulfillment_branch: 'NY',
    delivery_branch: 'LA',
  };
  assert.doesNotThrow(() => assertInventoryRequestRead({ request, actorBranch: 'NY' }));
  assert.doesNotThrow(() => assertInventoryRequestRead({ request, actorBranch: 'LA' }));
  assert.throws(
    () => assertInventoryRequestRead({ request, actorBranch: 'CH' }),
    /not have access/
  );
});

test('resolution fields must apply to the stored request scope', () => {
  assert.doesNotThrow(() => assertResolutionFieldApplies('stone_only', 'stone_found'));
  assert.doesNotThrow(() => assertResolutionFieldApplies('stone_only', 'not_found'));
  assert.throws(() => assertResolutionFieldApplies('stone_only', 'cert_found'), /does not request certificates/);
  assert.throws(() => assertResolutionFieldApplies('cert_only', 'stone_found'), /does not request stones/);
});

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

test('source inventory resolves an internal transfer before shipment', () => {
  const request = {
    cross_branch: true,
    fulfillment_branch: 'NY',
    delivery_branch: 'LA',
    delivery_route: 'internal_transfer',
    transfer_status: 'awaiting_source',
  };

  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request,
    actorBranch: 'NY',
    mutationField: 'stone_found',
  }));

  assert.throws(() => assertInventoryRequestMutation({
    request,
    actorBranch: 'LA',
    mutationField: 'stone_found',
  }), /Only supplying inventory/);
});

test('direct customer request resolution stays with supplying inventory', () => {
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
  }), /supplying inventory/);
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

test('confirmed resolution is immutable while later returns remain allowed', () => {
  const confirmed = {
    status: 'half_fulfilled',
    resolution_confirmed: true,
    cross_branch: false,
    fulfillment_branch: 'NY',
    branch: 'NY',
  };
  assert.throws(() => assertInventoryRequestMutation({
    request: confirmed,
    actorBranch: 'NY',
    mutationField: 'not_found',
  }), /already confirmed/);
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: { ...confirmed, status: 'fulfilled' },
    actorBranch: 'NY',
    mutationField: 'returned',
  }));
});
