// Batch-level status derivation, per spec:
// Awaiting        -> nothing checked yet on any stone
// Half fulfilled   -> some, but not all, stone+cert pairs complete
// Fulfilled        -> every stone has BOTH stone_found and cert_found true
//
// A request only counts as "returned" tracking-wise per-stone; the batch
// itself is Fulfilled purely based on stone_found+cert_found, independent of
// `returned`. Once Fulfilled, the request must be excluded from the
// "Active" view and only shown under "Completed".

function isStoneFulfilled(stone, requestScope = 'stone_and_cert') {
  if (requestScope === 'stone_only') return !!stone.stone_found;
  if (requestScope === 'cert_only') return !!stone.cert_found;
  return !!stone.stone_found && !!stone.cert_found;
}

function isStoneStarted(stone, requestScope = 'stone_and_cert') {
  if (requestScope === 'stone_only') return !!stone.stone_found;
  if (requestScope === 'cert_only') return !!stone.cert_found;
  return !!stone.stone_found || !!stone.cert_found;
}

function computeBatchStatus(stones, requestScope = 'stone_and_cert') {
  if (!stones || stones.length === 0) return 'awaiting';

  const anyChecked = stones.some((s) => isStoneStarted(s, requestScope));
  const allFulfilled = stones.every((s) => isStoneFulfilled(s, requestScope));

  if (allFulfilled) return 'fulfilled';
  if (anyChecked) return 'half_fulfilled';
  return 'awaiting';
}

function isActive(status) {
  return status !== 'fulfilled';
}

// Per-stone tracking status (for the Tracking tab), independent of batch status
function computeStoneTrackingStatus(stone) {
  if (stone.returned) return 'returned';
  if (stone.stone_found && stone.cert_found) return 'with_rep';
  if (stone.stone_found || stone.cert_found) return 'partially_given';
  return 'requested';
}

module.exports = { computeBatchStatus, isActive, computeStoneTrackingStatus, isStoneFulfilled };
