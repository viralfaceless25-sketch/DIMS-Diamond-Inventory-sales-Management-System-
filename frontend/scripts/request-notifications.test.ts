import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendUniqueNotification,
  isRequestNotification,
  notificationMessage,
  notificationVisibleForRole,
  type RequestNotification,
} from '../src/lib/requestNotifications';

const viewed: RequestNotification = {
  eventId: 'request-viewed:41',
  kind: 'request-viewed',
  requestId: 41,
  fulfillmentBranch: 'NY',
};

test('deduplicates repeated socket event IDs', () => {
  assert.equal(appendUniqueNotification([viewed], viewed).length, 1);
});

test('confirmed copy promises receipt without falsely claiming shipment', () => {
  const copy = notificationMessage({
    eventId: 'request-confirmed:41',
    kind: 'request-confirmed',
    requestId: 41,
    fulfillmentBranch: 'NY',
    foundCount: 2,
    notFoundCount: 1,
  });
  assert.match(copy.body, /receive it soon/i);
  assert.doesNotMatch(copy.body, /shipped/i);
  assert.equal(copy.href, '/rep/my-requests?requestId=41');
});

test('inventory preview names requester and limits display data', () => {
  const copy = notificationMessage({
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
  assert.match(copy.body, /Asha.*LA/);
  assert.match(copy.body, /A, B, C.*\+1/);
  assert.equal(copy.href, '/dashboard/requests?requestId=41');
});

test('client role filter rejects a notification for the wrong shell', () => {
  assert.equal(notificationVisibleForRole(viewed, 'sales_rep'), true);
  assert.equal(notificationVisibleForRole(viewed, 'inventory'), false);
});

test('rejects malformed socket payloads before rendering', () => {
  assert.equal(isRequestNotification({ kind: 'request-viewed', requestId: '41' }), false);
  assert.equal(isRequestNotification(viewed), true);
});
