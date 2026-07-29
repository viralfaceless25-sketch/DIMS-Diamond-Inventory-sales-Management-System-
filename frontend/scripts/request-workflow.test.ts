import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityText,
  canAddToHomeBranch,
  canRequestAvailability,
  canResolveSourceItems,
  defaultFulfillmentChoice,
  deliveryRouteForChoice,
  documentStepState,
  fulfillmentChoiceLabel,
  fulfillmentChoicesFor,
  fulfillmentLabel,
  hasDeliveryWorkflow,
  requestTypeForFulfillment,
} from '../src/lib/requestWorkflow';

test('only the supplying branch resolves internal-transfer items before shipment', () => {
  const request = {
    status: 'half_fulfilled',
    fulfillmentBranch: 'NY',
    deliveryRoute: 'internal_transfer' as const,
    transferStatus: 'awaiting_source',
  };

  assert.equal(canResolveSourceItems(request, 'NY'), true);
  assert.equal(canResolveSourceItems(request, 'LA'), false);
  assert.equal(canResolveSourceItems({
    ...request,
    transferStatus: 'ready_for_rep',
  }, 'NY'), false);
});

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

test('fulfillment choices switch between the four local and four BT workflows', () => {
  assert.deepEqual(fulfillmentChoicesFor(null, 'NY'), []);
  assert.deepEqual(
    fulfillmentChoicesFor('NY', 'NY'),
    ['local_urgent', 'local_dropoff', 'local_ship', 'local']
  );
  assert.deepEqual(
    fulfillmentChoicesFor('LA', 'NY'),
    [
      'bt_to_rep_branch',
      'bt_customer_ship',
      'bt_customer_dropoff',
      'bt_to_branch',
    ]
  );
  assert.equal(defaultFulfillmentChoice(null, 'NY'), null);
  assert.equal(defaultFulfillmentChoice('NY', 'NY'), 'local');
  assert.equal(defaultFulfillmentChoice('LA', 'NY'), 'bt_to_rep_branch');
});

test('BT choice labels and delivery routes use the rep branch', () => {
  assert.equal(
    fulfillmentChoiceLabel('bt_to_rep_branch', 'NY'),
    'BT ship stone/cert to NY'
  );
  assert.equal(
    fulfillmentChoiceLabel('bt_customer_ship', 'NY'),
    'BT ship stone/cert to customer'
  );
  assert.equal(
    fulfillmentChoiceLabel('bt_to_branch', 'NY'),
    'BT ship to another branch'
  );
  assert.equal(deliveryRouteForChoice('bt_to_rep_branch'), 'internal_transfer');
  assert.equal(deliveryRouteForChoice('bt_customer_ship'), 'customer_ship');
  assert.equal(deliveryRouteForChoice('local_dropoff'), 'customer_dropoff');
  assert.equal(deliveryRouteForChoice('local'), null);
});

test('version 2 document steps unlock in strict ERP and file order', () => {
  assert.deepEqual(documentStepState({
    workflowVersion: 2,
    crossBranch: true,
    erpTransferReceived: false,
    paperworkType: 'invoice',
    hasPaperwork: true,
    hasLabel: true,
  }), {
    paperworkEnabled: false,
    paperworkComplete: true,
    labelEnabled: false,
    ready: false,
  });
  assert.deepEqual(documentStepState({
    workflowVersion: 2,
    crossBranch: true,
    erpTransferReceived: true,
    paperworkType: 'invoice',
    hasPaperwork: true,
    hasLabel: false,
  }), {
    paperworkEnabled: true,
    paperworkComplete: true,
    labelEnabled: true,
    ready: false,
  });
});

test('legacy document workflow stays usable without new ERP receipt and file requirements', () => {
  assert.deepEqual(documentStepState({
    workflowVersion: 1,
    crossBranch: true,
    erpTransferReceived: false,
    paperworkType: 'none',
    hasPaperwork: false,
    hasLabel: true,
  }), {
    paperworkEnabled: true,
    paperworkComplete: true,
    labelEnabled: true,
    ready: true,
  });
});
