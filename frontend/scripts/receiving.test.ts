import test from 'node:test';
import assert from 'node:assert/strict';
import {
  batchReadyCount,
  branchToday,
  componentSummary,
  defaultCandidateId,
  defaultComponents,
  elsewhereMessage,
  receiptFormReady,
  shiftIsoDate,
} from '../src/lib/receiving';

test('one matching request is selected automatically but multiple matches require inventory choice', () => {
  assert.equal(defaultCandidateId([]), null);
  assert.equal(defaultCandidateId([{ requestStoneId: 12 }]), 12);
  assert.equal(
    defaultCandidateId([{ requestStoneId: 12 }, { requestStoneId: 14 }]),
    null
  );
});

test('receipt form requires explicit Stone and Cert choices and at least one received component', () => {
  const base = {
    barcode: '267157-00',
    stoneReceived: null,
    certReceived: null,
    candidateCount: 1,
    requestStoneId: 12,
    sourceBranch: 'CH',
    receivingBranch: 'NY',
  };

  assert.equal(receiptFormReady(base), false);
  assert.equal(receiptFormReady({
    ...base,
    stoneReceived: false,
    certReceived: false,
  }), false);
  assert.equal(receiptFormReady({
    ...base,
    stoneReceived: true,
    certReceived: false,
  }), true);
  assert.equal(receiptFormReady({
    ...base,
    candidateCount: 2,
    requestStoneId: null,
    stoneReceived: true,
    certReceived: false,
  }), false);
});

test('unmatched receipt requires a different valid source branch', () => {
  const base = {
    barcode: '267157-00',
    stoneReceived: false,
    certReceived: true,
    candidateCount: 0,
    requestStoneId: null,
    receivingBranch: 'LA',
  };

  assert.equal(receiptFormReady({ ...base, sourceBranch: '' }), false);
  assert.equal(receiptFormReady({ ...base, sourceBranch: 'LA' }), false);
  assert.equal(receiptFormReady({ ...base, sourceBranch: 'CH' }), true);
});

test('daily history navigation is stable across month and year boundaries', () => {
  assert.equal(shiftIsoDate('2026-07-01', -1), '2026-06-30');
  assert.equal(shiftIsoDate('2026-12-31', 1), '2027-01-01');
  assert.equal(
    branchToday('LA', new Date('2026-07-29T05:30:00.000Z')),
    '2026-07-28'
  );
  assert.equal(
    branchToday('CH', new Date('2026-07-29T05:30:00.000Z')),
    '2026-07-29'
  );
});

test('component summary mirrors the inventory yes/no sheet', () => {
  assert.equal(componentSummary(true, false), 'Stone: Yes · Cert: No');
  assert.equal(componentSummary(false, true), 'Stone: No · Cert: Yes');
});

test('batch rows pre-fill Stone/Cert from the matched request scope', () => {
  assert.deepEqual(defaultComponents('stone_and_cert'), { stoneReceived: true, certReceived: true });
  assert.deepEqual(defaultComponents('stone_only'), { stoneReceived: true, certReceived: false });
  assert.deepEqual(defaultComponents('cert_only'), { stoneReceived: false, certReceived: true });
  // Unmatched (no scope) defaults to both received; the user can flip either.
  assert.deepEqual(defaultComponents(undefined), { stoneReceived: true, certReceived: true });
});

test('batchReadyCount counts only rows that pass per-receipt validation', () => {
  const rows = [
    // ready: single matched request, one component received
    { barcode: 'A-1', stoneReceived: true, certReceived: true, candidateCount: 1, requestStoneId: 5, sourceBranch: '', receivingBranch: 'NY' },
    // not ready: multiple candidates, none chosen
    { barcode: 'A-2', stoneReceived: true, certReceived: false, candidateCount: 2, requestStoneId: null, sourceBranch: '', receivingBranch: 'NY' },
    // ready: unmatched with a valid different sending branch
    { barcode: 'A-3', stoneReceived: false, certReceived: true, candidateCount: 0, requestStoneId: null, sourceBranch: 'LA', receivingBranch: 'NY' },
    // not ready: nothing received
    { barcode: 'A-4', stoneReceived: false, certReceived: false, candidateCount: 1, requestStoneId: 9, sourceBranch: '', receivingBranch: 'NY' },
  ];
  assert.equal(batchReadyCount(rows), 2);
});

test('elsewhereMessage explains a misrouted barcode instead of a dead-end', () => {
  assert.equal(
    elsewhereMessage(null),
    'No open request matched. You can still save it for review after selecting the sending branch.'
  );
  assert.equal(
    elsewhereMessage({ destinationBranch: 'LA', receivableAtABranch: true, rep: { name: 'Romil' } }),
    'This barcode is being shipped to LA for Romil, not here. Ask LA inventory to receive it.'
  );
  assert.equal(
    elsewhereMessage({ destinationBranch: 'CH', receivableAtABranch: false, rep: { name: 'Karan' } }),
    'A request for this barcode exists but ships directly to the customer via Karan — it is not received at any branch stockroom.'
  );
});
