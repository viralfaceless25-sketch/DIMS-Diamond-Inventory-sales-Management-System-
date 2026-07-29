const { computeBatchStatus } = require('./statusService');

function canResolveRequest(stones, requestScope) {
  return computeBatchStatus(stones, requestScope) === 'fulfilled';
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
  canResolveRequest,
  deriveMutationState,
  deriveRequestStatus,
};
