const test = require('node:test');
const assert = require('node:assert/strict');
const {
  homeBranchForStock,
  deriveRequestRoute,
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

test('derives cross-branch shipping to the authenticated rep branch', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'LA',
      repBranch: 'NY',
      deliveryRoute: 'internal_transfer',
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

test('derives direct-customer fulfillment without trusting client branches', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'CH',
      repBranch: 'NY',
      deliveryRoute: 'customer_ship',
    }),
    {
      fulfillmentBranch: 'CH',
      deliveryBranch: 'NY',
      crossBranch: true,
      deliveryRoute: 'customer_ship',
      requestType: 'ship',
    }
  );
});

test('uses local pickup when the stone and rep share a branch', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'NY',
      repBranch: 'NY',
      deliveryRoute: 'internal_transfer',
    }),
    {
      fulfillmentBranch: 'NY',
      deliveryBranch: 'NY',
      crossBranch: false,
      deliveryRoute: null,
      requestType: 'pickup',
    }
  );
});

test('preserves direct-customer delivery when stock is local to the rep', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'NY',
      repBranch: 'NY',
      deliveryRoute: 'customer_ship',
    }),
    {
      fulfillmentBranch: 'NY',
      deliveryBranch: 'NY',
      crossBranch: false,
      deliveryRoute: 'customer_ship',
      requestType: 'ship',
    }
  );
});

test('defaults a missing fulfillment choice to ship-to-branch', () => {
  assert.equal(
    deriveRequestRoute({ homeBranch: 'LA', repBranch: 'NY' }).deliveryRoute,
    'internal_transfer'
  );
});
