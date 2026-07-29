const VALID_BRANCHES = new Set(['NY', 'LA', 'CH']);
const BRANCH_TIME_ZONES = Object.freeze({
  NY: 'America/New_York',
  LA: 'America/Los_Angeles',
  CH: 'America/Chicago',
});

function receiptError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeBarcode(value) {
  if (typeof value !== 'string') throw receiptError('Barcode is required');
  const barcode = value.trim().toUpperCase();
  if (!barcode) throw receiptError('Barcode is required');
  if (barcode.length > 64) throw receiptError('Barcode cannot exceed 64 characters');
  if (/[\u0000-\u001f\u007f]/.test(barcode)) {
    throw receiptError('Barcode contains invalid characters');
  }
  return barcode;
}

function normalizeSourceBranch(value) {
  if (value == null || value === '') return null;
  const branch = String(value).trim().toUpperCase();
  if (!VALID_BRANCHES.has(branch)) throw receiptError('A valid source branch is required');
  return branch;
}

function normalizeReceiptInput(input = {}) {
  const barcode = normalizeBarcode(input.barcode);
  if (typeof input.stoneReceived !== 'boolean' || typeof input.certReceived !== 'boolean') {
    throw receiptError('Stone and certificate must each be marked Yes or No');
  }
  if (!input.stoneReceived && !input.certReceived) {
    throw receiptError('Stone or certificate must be marked Yes');
  }

  const requestStoneId = input.requestStoneId == null || input.requestStoneId === ''
    ? null
    : Number(input.requestStoneId);
  if (requestStoneId !== null && (!Number.isInteger(requestStoneId) || requestStoneId <= 0)) {
    throw receiptError('A valid request stone is required');
  }

  const sourceBranch = normalizeSourceBranch(input.sourceBranch);
  if (requestStoneId === null && !sourceBranch) {
    throw receiptError('A source branch is required for an unmatched receipt');
  }

  const noteText = typeof input.note === 'string' ? input.note.trim() : '';
  if (noteText.length > 500) throw receiptError('Receipt note cannot exceed 500 characters');

  return {
    barcode,
    stoneReceived: input.stoneReceived,
    certReceived: input.certReceived,
    sourceBranch,
    requestStoneId,
    duplicateOverride: input.duplicateOverride === true,
    note: noteText || null,
  };
}

function branchLocalDate(branch, at = new Date()) {
  const normalizedBranch = normalizeSourceBranch(branch);
  const timeZone = BRANCH_TIME_ZONES[normalizedBranch];
  const instant = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(instant.getTime())) throw receiptError('A valid receipt time is required');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function expectedComponents(scope = 'stone_and_cert') {
  if (scope === 'stone_only') return { stone: true, cert: false };
  if (scope === 'cert_only') return { stone: false, cert: true };
  if (scope === 'stone_and_cert') return { stone: true, cert: true };
  throw receiptError('Unknown request scope');
}

function receiptRollup(requestStones = [], receipts = []) {
  const stones = requestStones.map((requestStone) => {
    const id = Number(requestStone.id);
    const expected = expectedComponents(requestStone.request_scope || requestStone.requestScope);
    const rows = receipts.filter((receipt) => Number(receipt.request_stone_id ?? receipt.requestStoneId) === id);
    const stoneReceived = rows.some((receipt) => Boolean(receipt.stone_received ?? receipt.stoneReceived));
    const certReceived = rows.some((receipt) => Boolean(receipt.cert_received ?? receipt.certReceived));
    const complete = (!expected.stone || stoneReceived) && (!expected.cert || certReceived);
    return { id, stoneReceived, certReceived, complete };
  });
  const anyReceived = stones.some((stone) => stone.stoneReceived || stone.certReceived);
  const complete = stones.length > 0 && stones.every((stone) => stone.complete);
  return {
    complete,
    partial: anyReceived && !complete,
    stones,
  };
}

function duplicateComponents(existingReceipts = [], input) {
  const duplicates = [];
  if (input.stoneReceived && existingReceipts.some((receipt) => Boolean(receipt.stone_received ?? receipt.stoneReceived))) {
    duplicates.push('stone');
  }
  if (input.certReceived && existingReceipts.some((receipt) => Boolean(receipt.cert_received ?? receipt.certReceived))) {
    duplicates.push('certificate');
  }
  return duplicates;
}

function nextPhysicalStatus(currentStatus, complete) {
  const status = currentStatus || 'awaiting_source';
  const preReceive = new Set([
    'awaiting_source',
    'packed',
    'shipped_to_destination',
    'received_at_destination',
    'ready_for_rep',
  ]);
  if (!preReceive.has(status)) return { status, mismatch: null };
  return {
    status: complete ? 'ready_for_rep' : 'received_at_destination',
    mismatch: ['awaiting_source', 'packed'].includes(status)
      ? {
        previousTransferStatus: status,
        reason: 'physical_arrival_ahead_of_workflow',
      }
      : null,
  };
}

function selectReceiptCandidate(candidates, requestStoneId, receivingBranch, barcode) {
  const normalizedBranch = normalizeSourceBranch(receivingBranch);
  const normalizedBarcode = normalizeBarcode(barcode);
  const normalizedId = Number(requestStoneId);
  const candidate = candidates.find((row) => (
    Number(row.requestStoneId ?? row.request_stone_id) === normalizedId
    && String(row.destinationBranch ?? row.destination_branch ?? '').toUpperCase() === normalizedBranch
    && String(row.barcode || '').trim().toUpperCase() === normalizedBarcode
  ));
  if (!candidate) {
    throw receiptError('The selected request is no longer eligible for this receipt', 409);
  }
  return candidate;
}

function assertHandoffAllowed({ request, receivingBranch, rollup }) {
  if (!request || request.delivery_route !== 'internal_transfer') {
    throw receiptError('Only an internal branch shipment can be handed to a sales rep', 409);
  }
  const destinationBranch = String(request.destination_branch || request.delivery_branch || request.branch || '').toUpperCase();
  if (destinationBranch !== normalizeSourceBranch(receivingBranch)) {
    throw receiptError('Only destination inventory can hand this shipment to the sales rep', 403);
  }
  if (request.status === 'cancelled') throw receiptError('A cancelled request cannot be handed over', 409);
  if (request.transfer_status === 'handed_to_rep') throw receiptError('This shipment was already handed to the sales rep', 409);
  if (!rollup?.complete) {
    throw receiptError('Stone and certificate arrivals must be complete before handoff', 409);
  }
}

function receiptStatusLabel({ matchState, requestComplete, transferStatus }) {
  if (matchState !== 'matched') return 'Needs review';
  if (transferStatus === 'handed_to_rep') return 'Handed over';
  if (requestComplete) return 'Ready for rep';
  return 'Partial arrival';
}

module.exports = {
  BRANCH_TIME_ZONES,
  VALID_BRANCHES,
  assertHandoffAllowed,
  branchLocalDate,
  duplicateComponents,
  expectedComponents,
  nextPhysicalStatus,
  normalizeBarcode,
  normalizeReceiptInput,
  receiptRollup,
  receiptStatusLabel,
  selectReceiptCandidate,
};
