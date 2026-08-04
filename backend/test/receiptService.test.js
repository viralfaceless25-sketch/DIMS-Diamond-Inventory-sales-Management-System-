const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertHandoffAllowed,
  assertReceiptCorrectionAllowed,
  branchLocalDate,
  duplicateComponents,
  expectedComponents,
  nextPhysicalStatus,
  normalizeReceiptInput,
  receiptRollup,
  receiptStatusLabel,
  selectReceiptCandidate,
} = require('../src/services/receiptService');

test('receipt input normalizes one shared barcode and explicit components', () => {
  assert.deepEqual(normalizeReceiptInput({
    barcode: ' 267157-00 ',
    stoneReceived: true,
    certReceived: false,
    sourceBranch: 'ch',
  }), {
    barcode: '267157-00',
    stoneReceived: true,
    certReceived: false,
    sourceBranch: 'CH',
    requestStoneId: null,
    duplicateOverride: false,
    note: null,
  });
});

test('receipt rejects an empty package and invalid source branch', () => {
  assert.throws(() => normalizeReceiptInput({
    barcode: '267157-00',
    stoneReceived: false,
    certReceived: false,
    sourceBranch: 'CH',
  }), /Stone or certificate/);
  assert.throws(() => normalizeReceiptInput({
    barcode: '267157-00',
    stoneReceived: true,
    certReceived: false,
    sourceBranch: 'SURAT',
  }), /source branch/);
});

test('matched input can derive its source branch from the selected request', () => {
  assert.deepEqual(normalizeReceiptInput({
    barcode: 'abc-123',
    stoneReceived: false,
    certReceived: true,
    requestStoneId: 42,
    duplicateOverride: true,
    note: 'Certificate envelope',
  }), {
    barcode: 'ABC-123',
    stoneReceived: false,
    certReceived: true,
    sourceBranch: null,
    requestStoneId: 42,
    duplicateOverride: true,
    note: 'Certificate envelope',
  });
});

test('branch dates use the receiving branch timezone without UTC drift', () => {
  const at = new Date('2026-07-29T05:30:00.000Z');
  assert.equal(branchLocalDate('NY', at), '2026-07-29');
  assert.equal(branchLocalDate('CH', at), '2026-07-29');
  assert.equal(branchLocalDate('LA', at), '2026-07-28');
});

test('separate stone and certificate arrivals complete one request stone', () => {
  const result = receiptRollup(
    [{ id: 7, request_scope: 'stone_and_cert' }],
    [
      { request_stone_id: 7, stone_received: false, cert_received: true },
      { request_stone_id: 7, stone_received: true, cert_received: false },
    ]
  );

  assert.deepEqual(result, {
    complete: true,
    partial: false,
    stones: [{
      id: 7,
      stoneReceived: true,
      certReceived: true,
      complete: true,
    }],
  });
});

test('multi-stone rollup remains partial until every expected component arrives', () => {
  const result = receiptRollup(
    [
      { id: 7, request_scope: 'stone_only' },
      { id: 8, request_scope: 'stone_only' },
    ],
    [{ request_stone_id: 7, stone_received: true, cert_received: false }]
  );

  assert.equal(result.complete, false);
  assert.equal(result.partial, true);
  assert.deepEqual(result.stones.map((stone) => stone.complete), [true, false]);
});

test('expected components follow the request scope', () => {
  assert.deepEqual(expectedComponents('stone_and_cert'), { stone: true, cert: true });
  assert.deepEqual(expectedComponents('stone_only'), { stone: true, cert: false });
  assert.deepEqual(expectedComponents('cert_only'), { stone: false, cert: true });
});

test('duplicate detection names only components already received', () => {
  assert.deepEqual(duplicateComponents(
    [
      { stone_received: true, cert_received: false },
      { stone_received: false, cert_received: false },
    ],
    { stoneReceived: true, certReceived: true }
  ), ['stone']);
});

test('physical arrival catches up the internal workflow but reports skipped steps', () => {
  assert.deepEqual(nextPhysicalStatus('packed', false), {
    status: 'received_at_destination',
    mismatch: {
      previousTransferStatus: 'packed',
      reason: 'physical_arrival_ahead_of_workflow',
    },
  });
  assert.deepEqual(nextPhysicalStatus('shipped_to_destination', true), {
    status: 'ready_for_rep',
    mismatch: null,
  });
  assert.deepEqual(nextPhysicalStatus('handed_to_rep', true), {
    status: 'handed_to_rep',
    mismatch: null,
  });
  assert.deepEqual(nextPhysicalStatus('ready_for_rep', false), {
    status: 'received_at_destination',
    mismatch: null,
  });
});

test('selected match must belong to the scanned barcode and receiving branch', () => {
  const candidates = [{
    requestStoneId: 42,
    requestId: 9,
    barcode: '267157-00',
    destinationBranch: 'NY',
    sourceBranch: 'CH',
  }];

  assert.equal(
    selectReceiptCandidate(candidates, 42, 'NY', '267157-00').requestId,
    9
  );
  assert.throws(
    () => selectReceiptCandidate(candidates, 42, 'LA', '267157-00'),
    /no longer eligible/
  );
  assert.throws(
    () => selectReceiptCandidate(candidates, 42, 'NY', 'OTHER-1'),
    /no longer eligible/
  );
});

test('handoff requires a complete internal shipment at its destination branch', () => {
  const request = {
    delivery_route: 'internal_transfer',
    destination_branch: 'NY',
    transfer_status: 'ready_for_rep',
    status: 'half_fulfilled',
  };
  assert.doesNotThrow(() => assertHandoffAllowed({
    request,
    receivingBranch: 'NY',
    rollup: { complete: true },
  }));
  assert.throws(() => assertHandoffAllowed({
    request,
    receivingBranch: 'LA',
    rollup: { complete: true },
  }), /destination inventory/);
  assert.throws(() => assertHandoffAllowed({
    request,
    receivingBranch: 'NY',
    rollup: { complete: false },
  }), /Stone and certificate arrivals/);
});

test('receipt correction guard leaves pre-terminal matched requests correctable', () => {
  assert.doesNotThrow(() => assertReceiptCorrectionAllowed({ transfer_status: 'ready_for_rep' }));
  assert.doesNotThrow(() => assertReceiptCorrectionAllowed({ transfer_status: 'received_at_destination' }));
  assert.throws(
    () => assertReceiptCorrectionAllowed({ transfer_status: 'handed_to_rep' }),
    (error) => error.status === 409 && error.message === 'This shipment was already handed to the sales rep'
  );
});

test('receipt status labels support daily inventory triage', () => {
  assert.equal(receiptStatusLabel({
    matchState: 'unmatched',
    requestComplete: false,
    transferStatus: null,
  }), 'Needs review');
  assert.equal(receiptStatusLabel({
    matchState: 'matched',
    requestComplete: false,
    transferStatus: 'received_at_destination',
  }), 'Partial arrival');
  assert.equal(receiptStatusLabel({
    matchState: 'matched',
    requestComplete: true,
    transferStatus: 'ready_for_rep',
  }), 'Ready for rep');
  assert.equal(receiptStatusLabel({
    matchState: 'matched',
    requestComplete: true,
    transferStatus: 'handed_to_rep',
  }), 'Handed over');
});
