const { computeBatchStatus } = require('./statusService');

function canResolveRequest(stones, requestScope) {
  return computeBatchStatus(stones, requestScope) === 'fulfilled';
}

function isStoneDeliberatelyResolved(stone, requestScope) {
  if (stone.not_found) return true;
  if (requestScope === 'stone_only') return Boolean(stone.stone_found);
  if (requestScope === 'cert_only') return Boolean(stone.cert_found);
  return Boolean(stone.stone_found || stone.cert_found);
}

function canConfirmResolution(stones, requestScope) {
  return stones.length > 0
    && stones.every((stone) => isStoneDeliberatelyResolved(stone, requestScope));
}

function deriveRequestStatus(
  stones,
  requestScope,
  resolutionConfirmed,
  deliveryPending = false
) {
  if (resolutionConfirmed) {
    return deliveryPending ? 'half_fulfilled' : 'fulfilled';
  }
  const calculated = computeBatchStatus(stones, requestScope);
  return calculated === 'fulfilled' && !resolutionConfirmed ? 'half_fulfilled' : calculated;
}

function deriveMutationState({
  stones,
  requestScope,
  mutationField,
  currentStatus,
  currentResolutionConfirmed,
}) {
  if (mutationField === 'returned') {
    return {
      status: currentStatus,
      resolutionConfirmed: Boolean(currentResolutionConfirmed),
    };
  }
  return {
    status: deriveRequestStatus(stones, requestScope, false),
    resolutionConfirmed: false,
  };
}

module.exports = {
  canConfirmResolution,
  canResolveRequest,
  deriveMutationState,
  deriveRequestStatus,
  isStoneDeliberatelyResolved,
};
