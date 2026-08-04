function requestError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertInventoryRequestMutation({
  request,
  actorBranch,
  mutationField = null,
}) {
  if (request.status === 'cancelled') {
    throw requestError('A cancelled request cannot be updated');
  }
  if (request.resolution_confirmed
    && mutationField
    && !['returned', 'confirm_resolution'].includes(mutationField)) {
    throw requestError('This request resolution is already confirmed and cannot be changed');
  }
  if (mutationField === 'returned' && request.status !== 'fulfilled') {
    throw requestError('A return can be recorded only for a completed request');
  }
  const sourceBranch = request.fulfillment_branch || request.branch;

  if (!request.cross_branch) {
    if (actorBranch !== sourceBranch) {
      throw requestError(`Only ${sourceBranch} inventory can update this local request`, 403);
    }
    return;
  }

  const route = request.delivery_route;
  const status = request.transfer_status || 'awaiting_source';
  if (route === 'internal_transfer') {
    const destinationBranch = request.delivery_branch || request.branch;
    if (mutationField === 'returned') {
      if (actorBranch !== destinationBranch || status !== 'handed_to_rep') {
        throw requestError('Only destination inventory can record a return after handoff to the sales rep');
      }
      return;
    }
    if (actorBranch !== sourceBranch || !['awaiting_source', 'packed'].includes(status)) {
      throw requestError('Only supplying inventory can confirm requested stones and certificates before shipment');
    }
    return;
  }

  const allowedStatus = mutationField === 'returned'
    ? route === 'customer_ship'
      ? 'shipped_to_customer'
      : 'dropped_off_to_customer'
    : 'packed';
  if (actorBranch !== sourceBranch || status !== allowedStatus) {
    throw requestError(
      mutationField === 'returned'
        ? 'Only supplying inventory can record a returned customer delivery'
        : 'Only supplying inventory can confirm stones after the package is marked packed'
    );
  }
}

function assertResolutionFieldApplies(requestScope, field) {
  if (!field || ['not_found', 'returned', 'resolution'].includes(field)) return;
  if (requestScope === 'stone_only' && field === 'cert_found') {
    throw requestError('This request does not request certificates');
  }
  if (requestScope === 'cert_only' && field === 'stone_found') {
    throw requestError('This request does not request stones');
  }
}

function assertInventoryRequestRead({ request, actorBranch }) {
  const authorizedBranches = new Set([
    request.branch,
    request.fulfillment_branch || request.branch,
    request.delivery_branch || request.branch,
  ]);
  if (!authorizedBranches.has(actorBranch)) {
    throw requestError('You do not have access to this request', 403);
  }
}

function assertInventoryRequestView({ request, actorBranch }) {
  const sourceBranch = request.fulfillment_branch || request.branch;
  if (actorBranch !== sourceBranch) {
    throw requestError(`Only ${sourceBranch} inventory can view this request`, 403);
  }
}

module.exports = {
  assertInventoryRequestMutation,
  assertInventoryRequestRead,
  assertInventoryRequestView,
  assertResolutionFieldApplies,
};
