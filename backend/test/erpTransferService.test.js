const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertErpTransferAction,
  buildErpUnavailableResolution,
} = require('../src/services/erpTransferService');

test('only source inventory can confirm ERP BT issue', () => {
  const request = {
    cross_branch: true,
    fulfillment_branch: 'LA',
    delivery_branch: 'NY',
  };

  assert.doesNotThrow(() => assertErpTransferAction({
    request,
    actorRole: 'inventory',
    actorBranch: 'LA',
    action: 'issue',
  }));
  assert.throws(
    () => assertErpTransferAction({
      request,
      actorRole: 'inventory',
      actorBranch: 'NY',
      action: 'issue',
    }),
    /Only LA inventory/
  );
});

test('destination receipt is digital and independent of physical arrival', () => {
  assert.doesNotThrow(() => assertErpTransferAction({
    request: {
      cross_branch: true,
      fulfillment_branch: 'LA',
      delivery_branch: 'NY',
      erp_transfer_confirmed: true,
      transfer_status: 'packed',
    },
    actorRole: 'inventory',
    actorBranch: 'NY',
    action: 'receive',
  }));

  assert.doesNotThrow(() => assertErpTransferAction({
    request: {
      cross_branch: true,
      fulfillment_branch: 'LA',
      delivery_branch: 'NY',
      erp_transfer_confirmed: true,
      transfer_status: 'handed_to_rep',
    },
    actorRole: 'inventory',
    actorBranch: 'NY',
    action: 'receive',
  }));
});

test('ERP BT receipt cannot precede issue', () => {
  assert.throws(
    () => assertErpTransferAction({
      request: {
        cross_branch: true,
        fulfillment_branch: 'LA',
        delivery_branch: 'NY',
        erp_transfer_confirmed: false,
      },
      actorRole: 'inventory',
      actorBranch: 'NY',
      action: 'receive',
    }),
    /issued in ERP first/
  );
});

test('only the request owner can ask destination inventory to receive ERP BT', () => {
  const request = {
    cross_branch: true,
    sales_rep_id: 17,
    fulfillment_branch: 'LA',
    delivery_branch: 'NY',
  };

  assert.doesNotThrow(() => assertErpTransferAction({
    request,
    actorRole: 'sales_rep',
    actorSalesRepId: 17,
    action: 'request_receive',
  }));
  assert.throws(
    () => assertErpTransferAction({
      request,
      actorRole: 'sales_rep',
      actorSalesRepId: 18,
      action: 'request_receive',
    }),
    /request owner/
  );
});

test('only source inventory can reject a BT before it is issued', () => {
  const request = {
    cross_branch: true,
    fulfillment_branch: 'LA',
    delivery_branch: 'NY',
    erp_transfer_confirmed: false,
  };
  assert.doesNotThrow(() => assertErpTransferAction({
    request,
    actorRole: 'inventory',
    actorBranch: 'LA',
    action: 'reject_unavailable',
  }));
  assert.throws(() => assertErpTransferAction({
    request,
    actorRole: 'inventory',
    actorBranch: 'NY',
    action: 'reject_unavailable',
  }), /Only LA inventory/);
  assert.throws(() => assertErpTransferAction({
    request: { ...request, erp_transfer_confirmed: true },
    actorRole: 'inventory',
    actorBranch: 'LA',
    action: 'reject_unavailable',
  }), /already been issued/);
});

test('ERP rejection records a real unavailable status and bounded reason', () => {
  assert.deepEqual(buildErpUnavailableResolution({
    liveStatus: 'On Hold',
    reason: ' Customer has not released it ',
  }), {
    liveStatus: 'on_hold',
    reason: 'Customer has not released it',
  });
  assert.throws(
    () => buildErpUnavailableResolution({ liveStatus: 'available' }),
    /unavailable ERP status/
  );
  assert.throws(
    () => buildErpUnavailableResolution({
      liveStatus: 'on_memo',
      reason: 'R'.repeat(501),
    }),
    /500 characters/
  );
});

test('cancelled requests reject every later ERP action', () => {
  assert.throws(() => assertErpTransferAction({
    request: {
      status: 'cancelled',
      cross_branch: true,
      fulfillment_branch: 'LA',
      delivery_branch: 'NY',
      erp_transfer_confirmed: false,
    },
    actorRole: 'inventory',
    actorBranch: 'LA',
    action: 'issue',
  }), /cancelled request/);
});
