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
    const allowedStatus = mutationField === 'returned'
      ? 'handed_to_rep'
      : 'ready_for_rep';
    if (actorBranch !== destinationBranch || status !== allowedStatus) {
      throw requestError(
        mutationField === 'returned'
          ? 'Only destination inventory can record a return after handoff to the sales rep'
          : 'Only destination inventory can confirm stones after the transfer is ready for the sales rep'
      );
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

module.exports = { assertInventoryRequestMutation };
