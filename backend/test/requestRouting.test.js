const test = require('node:test');
const assert = require('node:assert/strict');
const {
  homeBranchForStock,
  deriveRequestRoute,
  legacyFulfillmentChoice,
} = require('../src/services/requestRouting');

test('uses the stone branch as the supplying home branch', () => {
  assert.equal(
    homeBranchForStock([
      { barcode: '1509112-046', branch: 'LA' },
      { barcode: '1509112-047', branch: 'LA' },
    ]),
    'LA'
  );
});

test('rejects requests that mix home branches', () => {
  assert.throws(
    () => homeBranchForStock([
      { barcode: '1509112-046', branch: 'LA' },
      { barcode: '1509112-047', branch: 'CH' },
    ]),
    /one home branch/
  );
});

test('rejects missing or invalid home-branch data', () => {
  assert.throws(() => homeBranchForStock([]), /home branch/);
  assert.throws(
    () => homeBranchForStock([{ barcode: '1509112-046', branch: 'SURAT' }]),
    /recognized home branch/
  );
});

test('same-branch stock accepts the four local choices', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'NY',
      repBranch: 'NY',
      fulfillmentChoice: 'local_urgent',
    }),
    {
      fulfillmentBranch: 'NY',
      deliveryBranch: 'NY',
      crossBranch: false,
      deliveryRoute: null,
      requestType: 'urgent',
    }
  );
  assert.equal(deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'local',
  }).requestType, 'local');
  assert.equal(deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'local_ship',
  }).deliveryRoute, 'customer_ship');
  assert.equal(deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'local_dropoff',
  }).deliveryRoute, 'customer_dropoff');
});

test('cross-branch default destination is the authenticated rep branch', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'LA',
      repBranch: 'NY',
      fulfillmentChoice: 'bt_to_rep_branch',
    }),
    {
      fulfillmentBranch: 'LA',
      deliveryBranch: 'NY',
      crossBranch: true,
      deliveryRoute: 'internal_transfer',
      requestType: 'ship',
    }
  );
});

test('explicit BT destination accepts a real non-source branch only', () => {
  assert.equal(deriveRequestRoute({
    homeBranch: 'LA',
    repBranch: 'NY',
    fulfillmentChoice: 'bt_to_branch',
    deliveryBranch: 'CH',
  }).deliveryBranch, 'CH');
  assert.throws(() => deriveRequestRoute({
    homeBranch: 'LA',
    repBranch: 'NY',
    fulfillmentChoice: 'bt_to_branch',
    deliveryBranch: 'LA',
  }), /different from the stone home branch/);
});

test('local and BT choice sets cannot be used for the wrong stock location', () => {
  assert.throws(
    () => deriveRequestRoute({
      homeBranch: 'LA',
      repBranch: 'NY',
      fulfillmentChoice: 'local',
    }),
    (error) => error.status === 409 && /branch-transfer choice/.test(error.message)
  );
  assert.throws(() => deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'bt_to_rep_branch',
  }), /local choice/);
});

test('legacy clients map their route to the correct conditional choice', () => {
  assert.equal(legacyFulfillmentChoice({
    homeBranch: 'NY',
    repBranch: 'NY',
    deliveryRoute: 'customer_ship',
  }), 'local_ship');
  assert.equal(legacyFulfillmentChoice({
    homeBranch: 'LA',
    repBranch: 'NY',
    deliveryRoute: 'customer_dropoff',
  }), 'bt_customer_dropoff');
  assert.equal(legacyFulfillmentChoice({
    homeBranch: 'LA',
    repBranch: 'NY',
    deliveryRoute: 'internal_transfer',
  }), 'bt_to_rep_branch');
});
