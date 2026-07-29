const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveMutationState,
  deriveRequestStatus,
  canResolveRequest,
} = require('../src/services/resolutionService');

const complete = [{ stone_found: true, cert_found: true }];

test('fully checked requests stay active until inventory confirms resolution', () => {
  assert.equal(deriveRequestStatus(complete, 'stone_and_cert', false), 'half_fulfilled');
  assert.equal(deriveRequestStatus(complete, 'stone_and_cert', true), 'fulfilled');
  assert.equal(canResolveRequest(complete, 'stone_and_cert'), true);
});

test('resolution respects stone-only and cert-only request scopes', () => {
  assert.equal(canResolveRequest([{ stone_found: true, cert_found: false }], 'stone_only'), true);
  assert.equal(canResolveRequest([{ stone_found: false, cert_found: true }], 'cert_only'), true);
  assert.equal(canResolveRequest([{ stone_found: true, cert_found: false }], 'stone_and_cert'), false);
});

test('inventory confirmation can close a partially fulfilled request', () => {
  const partial = [
    { stone_found: true, cert_found: true },
    { stone_found: false, cert_found: false },
  ];

  assert.equal(deriveRequestStatus(partial, 'stone_and_cert', false), 'half_fulfilled');
  assert.equal(deriveRequestStatus(partial, 'stone_and_cert', true), 'fulfilled');
});

test('a delivery request stays active after item review until final delivery', () => {
  assert.equal(
    deriveRequestStatus(complete, 'stone_and_cert', true, true),
    'half_fulfilled'
  );
});

test('recording a later return preserves final request resolution', () => {
  assert.deepEqual(deriveMutationState({
    stones: [{ stone_found: true, cert_found: true, returned: true }],
    requestScope: 'stone_and_cert',
    mutationField: 'returned',
    currentStatus: 'fulfilled',
    currentResolutionConfirmed: true,
  }), {
    status: 'fulfilled',
    resolutionConfirmed: true,
  });
});
