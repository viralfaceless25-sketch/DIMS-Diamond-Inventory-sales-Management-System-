const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canConfirmResolution,
  assertRequestReadyForFinalDelivery,
  deriveMutationState,
  deriveRequestStatus,
  canResolveRequest,
  isStoneDeliberatelyResolved,
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

test('not found explicitly resolves an otherwise missing row', () => {
  const stone = { stone_found: false, cert_found: false, not_found: true };
  assert.equal(isStoneDeliberatelyResolved(stone, 'stone_and_cert'), true);
  assert.equal(canConfirmResolution([stone], 'stone_and_cert'), true);
});

test('combined requests permit deliberate partial results', () => {
  assert.equal(canConfirmResolution([
    { stone_found: true, cert_found: false, not_found: false },
  ], 'stone_and_cert'), true);
  assert.equal(canConfirmResolution([
    { stone_found: false, cert_found: true, not_found: false },
  ], 'stone_and_cert'), true);
});

test('an untouched row cannot be confirmed', () => {
  assert.equal(canConfirmResolution([
    { stone_found: false, cert_found: false, not_found: false },
  ], 'stone_and_cert'), false);
  assert.equal(canConfirmResolution([], 'stone_and_cert'), false);
});

test('scope-specific requests require their applicable found control', () => {
  assert.equal(canConfirmResolution([
    { stone_found: false, cert_found: true, not_found: false },
  ], 'stone_only'), false);
  assert.equal(canConfirmResolution([
    { stone_found: true, cert_found: false, not_found: false },
  ], 'cert_only'), false);
});

test('final delivery accepts explicit not-found rows after confirmation', async () => {
  await assert.doesNotReject(() => assertRequestReadyForFinalDelivery({
    query: async () => ({ rows: [
      { stone_found: true, cert_found: false, not_found: false },
      { stone_found: false, cert_found: false, not_found: true },
    ] }),
  }, 41, 'stone_and_cert'));
});

test('final delivery rejects untouched rows', async () => {
  await assert.rejects(() => assertRequestReadyForFinalDelivery({
    query: async () => ({ rows: [
      { stone_found: false, cert_found: false, not_found: false },
    ] }),
  }, 41, 'stone_and_cert'), /Resolve every item/);
});
