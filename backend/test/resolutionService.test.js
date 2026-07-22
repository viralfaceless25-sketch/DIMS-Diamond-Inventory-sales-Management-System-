const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveRequestStatus, canResolveRequest } = require('../src/services/resolutionService');

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
