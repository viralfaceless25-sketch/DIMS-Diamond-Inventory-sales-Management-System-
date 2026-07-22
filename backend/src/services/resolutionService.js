const { computeBatchStatus } = require('./statusService');

function canResolveRequest(stones, requestScope) {
  return computeBatchStatus(stones, requestScope) === 'fulfilled';
}

function deriveRequestStatus(stones, requestScope, resolutionConfirmed) {
  if (resolutionConfirmed) return 'fulfilled';
  const calculated = computeBatchStatus(stones, requestScope);
  return calculated === 'fulfilled' && !resolutionConfirmed ? 'half_fulfilled' : calculated;
}

module.exports = { canResolveRequest, deriveRequestStatus };
