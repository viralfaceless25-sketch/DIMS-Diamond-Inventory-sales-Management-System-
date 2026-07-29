function requestError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertInventoryRequestMutation({ request, actorBranch }) {
  if (request.status === 'cancelled') {
    throw requestError('A cancelled request cannot be updated');
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
    if (actorBranch !== destinationBranch || status !== 'ready_for_rep') {
      throw requestError(
        'Only destination inventory can confirm stones after the transfer is ready for the sales rep'
      );
    }
    return;
  }

  if (actorBranch !== sourceBranch || status !== 'packed') {
    throw requestError(
      'Only supplying inventory can confirm stones after the package is marked packed'
    );
  }
}

module.exports = { assertInventoryRequestMutation };
