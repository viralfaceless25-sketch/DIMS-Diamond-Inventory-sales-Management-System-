import test from 'node:test';
import assert from 'node:assert/strict';
import {
  branchToday,
  componentSummary,
  defaultCandidateId,
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
