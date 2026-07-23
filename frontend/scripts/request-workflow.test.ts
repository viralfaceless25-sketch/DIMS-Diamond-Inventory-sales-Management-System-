import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityText,
  canAddToHomeBranch,
  canRequestAvailability,
  fulfillmentLabel,
  hasDeliveryWorkflow,
  requestTypeForFulfillment,
} from '../src/lib/requestWorkflow';

test('in-transit availability is explicit and blocked', () => {
  assert.equal(
    availabilityText({ status: 'in_transit', label: 'In Transit' }),
    'In Transit'
  );
  assert.equal(canRequestAvailability({ status: 'in_transit' }), false);
});

test('memo and hold availability use exact ERP status labels', () => {
  assert.equal(availabilityText({ status: 'on_memo' }), 'On Memo');
  assert.equal(availabilityText({ status: 'on_hold' }), 'On Hold');
});

test('fulfillment labels use the authenticated rep branch', () => {
  assert.equal(
    fulfillmentLabel('internal_transfer', 'NY', 'LA'),
    'Ship to my branch (NY)'
  );
  assert.equal(
    fulfillmentLabel('internal_transfer', 'NY', 'NY'),
    'Stockroom pickup (NY)'
  );
  assert.equal(
    fulfillmentLabel('customer_ship', 'NY', 'LA'),
    'Ship directly to customer'
  );
});

test('a request cart cannot mix source branches', () => {
  assert.equal(canAddToHomeBranch(null, 'LA'), true);
  assert.equal(canAddToHomeBranch('LA', 'LA'), true);
  assert.equal(canAddToHomeBranch('LA', 'CH'), false);
});

test('request type is derived from the fulfillment choice', () => {
  assert.equal(requestTypeForFulfillment('internal_transfer', false), 'pickup');
  assert.equal(requestTypeForFulfillment('internal_transfer', true), 'ship');
  assert.equal(requestTypeForFulfillment('customer_ship', true), 'ship');
  assert.equal(requestTypeForFulfillment('customer_dropoff', true), 'dropoff');
});

test('local direct-customer choices still use the delivery workflow', () => {
  assert.equal(hasDeliveryWorkflow(false, 'customer_ship'), true);
  assert.equal(hasDeliveryWorkflow(false, 'customer_dropoff'), true);
  assert.equal(hasDeliveryWorkflow(false, 'internal_transfer'), false);
});
