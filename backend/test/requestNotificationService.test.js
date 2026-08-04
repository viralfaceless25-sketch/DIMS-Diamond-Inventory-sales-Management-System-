const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRequestCreatedNotification,
  inventoryRoom,
  userRoom,
} = require('../src/services/requestNotificationService');

test('request preview identifies the rep and is bounded to three barcodes', () => {
  const payload = buildRequestCreatedNotification({
    id: 41,
    repName: 'Asha',
    repBranch: 'LA',
    requestType: 'local',
    requestScope: 'stone_and_cert',
    fulfillmentBranch: 'NY',
  }, ['A', 'B', 'C', 'D'].map((barcode) => ({ barcode })));

  assert.deepEqual(payload, {
    eventId: 'request-created:41',
    kind: 'request-created',
    requestId: 41,
    repName: 'Asha',
    repBranch: 'LA',
    requestType: 'local',
    requestScope: 'stone_and_cert',
    fulfillmentBranch: 'NY',
    itemCount: 4,
    previewBarcodes: ['A', 'B', 'C'],
    remainingCount: 1,
  });
});

test('target room builders reject malformed identities and branches', () => {
  assert.equal(userRoom(9), 'user:9');
  assert.equal(inventoryRoom('la'), 'inventory:LA');
  assert.equal(userRoom('9 OR 1=1'), null);
  assert.equal(inventoryRoom('../ALL'), null);
});
