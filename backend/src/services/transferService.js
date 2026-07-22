const INTERNAL_STEPS = {
  awaiting_source: { pack: 'packed' },
  packed: { ship: 'shipped_to_destination' },
  shipped_to_destination: { receive: 'received_at_destination' },
  received_at_destination: { ready: 'ready_for_rep' },
  ready_for_rep: { hand_to_rep: 'handed_to_rep' },
};

const CUSTOMER_SHIP_STEPS = {
  awaiting_source: { pack: 'packed' },
  packed: { ship_customer: 'shipped_to_customer' },
};

const CUSTOMER_DROPOFF_STEPS = {
  awaiting_source: { pack: 'packed' },
  packed: { dropoff_customer: 'dropped_off_to_customer' },
};

function getTransferAction({ route, status, sourceBranch, destinationBranch, actorBranch, action, hasLabel = false, paperworkType = 'none' }) {
  const sourceOnly = ['pack', 'ship', 'ship_customer', 'dropoff_customer'];
  const destinationOnly = ['receive', 'ready', 'hand_to_rep'];
  if (sourceOnly.includes(action) && actorBranch !== sourceBranch) {
    throw new Error(`Only the supplying branch (${sourceBranch}) can ${action.replace('_', ' ')}`);
  }
  if (destinationOnly.includes(action) && actorBranch !== destinationBranch) {
    throw new Error(`Only the destination branch (${destinationBranch}) can ${action.replace('_', ' ')}`);
  }
  const steps = route === 'internal_transfer' ? INTERNAL_STEPS
    : route === 'customer_ship' ? CUSTOMER_SHIP_STEPS
      : route === 'customer_dropoff' ? CUSTOMER_DROPOFF_STEPS : null;
  if (!steps || !steps[status] || !steps[status][action]) {
    throw new Error(`This transfer action is not allowed while the request is ${status}`);
  }
  if (route === 'customer_ship' && action === 'ship_customer' && !hasLabel) {
    throw new Error('A shipping label must be uploaded before shipping to the customer');
  }
  if (route === 'customer_ship' && action === 'ship_customer' && paperworkType === 'pending') {
    throw new Error('A paperwork decision is required before shipping to the customer');
  }
  return steps[status][action];
}

function isCrossBranchRoute(route) {
  return ['internal_transfer', 'customer_ship', 'customer_dropoff'].includes(route);
}

module.exports = { getTransferAction, isCrossBranchRoute };
