const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildConfirmedNotification,
  buildViewedNotification,
  recordFirstView,
  requestingUserId,
} = require('../src/services/requestLifecycleService');

test('first view is an atomic first-write transition', async () => {
  const calls = [];
  const first = await recordFirstView({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ inventory_viewed_at: '2026-08-04T12:00:00Z', inventory_viewed_by: 7 }] };
    },
  }, 41, 7);
  const repeated = await recordFirstView({ query: async () => ({ rows: [] }) }, 41, 8);

  assert.deepEqual(first, {
    inventoryViewedAt: '2026-08-04T12:00:00Z',
    inventoryViewedBy: 7,
    firstView: true,
  });
  assert.deepEqual(repeated, { firstView: false });
  assert.match(calls[0].sql, /inventory_viewed_at IS NULL/);
  assert.deepEqual(calls[0].params, [41, 7]);
});

test('request owner lookup prefers the creating user and supports legacy rows', async () => {
  const direct = await requestingUserId({ query: async () => ({ rows: [{ user_id: 22 }] }) }, 41);
  assert.equal(direct, 22);
});

test('viewed and confirmed payloads have stable event IDs and safe copy data', () => {
  assert.deepEqual(buildViewedNotification({ id: 41, fulfillmentBranch: 'NY' }), {
    eventId: 'request-viewed:41', kind: 'request-viewed', requestId: 41, fulfillmentBranch: 'NY',
  });
  assert.deepEqual(buildConfirmedNotification({ id: 41, fulfillmentBranch: 'NY', foundCount: 2, notFoundCount: 1 }), {
    eventId: 'request-confirmed:41', kind: 'request-confirmed', requestId: 41,
    fulfillmentBranch: 'NY', foundCount: 2, notFoundCount: 1,
  });
});
