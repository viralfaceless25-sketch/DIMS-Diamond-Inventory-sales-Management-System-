const VALID_BRANCHES = new Set(['NY', 'LA', 'CH']);
const LOCAL_CHOICES = new Set([
  'local_urgent',
  'local_dropoff',
  'local_ship',
  'local',
]);
const BT_CHOICES = new Set([
  'bt_to_rep_branch',
  'bt_customer_ship',
  'bt_customer_dropoff',
  'bt_to_branch',
]);

function routingError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function assertBranch(branch, description) {
  if (!VALID_BRANCHES.has(branch)) {
    throw routingError(`${description} is not a recognized home branch`);
  }
}

function homeBranchForStock(stones) {
  if (!Array.isArray(stones) || stones.length === 0) {
    throw routingError('At least one stone with a home branch is required');
  }

  const branches = new Set();
  for (const stone of stones) {
    const branch = String(stone?.branch || '').trim().toUpperCase();
    assertBranch(branch, `Stone ${stone?.barcode || ''}`.trim());
    branches.add(branch);
  }

  if (branches.size !== 1) {
    throw routingError('Each request must contain stones from one home branch; submit the current request before requesting another branch');
  }

  return [...branches][0];
}

function deriveRequestRoute({
  homeBranch,
  repBranch,
  fulfillmentChoice,
  deliveryBranch,
}) {
  assertBranch(homeBranch, 'Stone');
  assertBranch(repBranch, 'Sales rep');

  const isLocal = homeBranch === repBranch;
  if (isLocal && !LOCAL_CHOICES.has(fulfillmentChoice)) {
    throw routingError('Choose a local choice for stock in your own branch');
  }
  if (!isLocal && !BT_CHOICES.has(fulfillmentChoice)) {
    throw routingError('Choose a branch-transfer choice for stock in another branch');
  }

  let route = null;
  let destination = repBranch;
  let requestType = 'ship';

  if (isLocal) {
    const localRoutes = {
      local_urgent: { route: null, requestType: 'urgent' },
      local_dropoff: { route: 'customer_dropoff', requestType: 'dropoff' },
      local_ship: { route: 'customer_ship', requestType: 'ship' },
      local: { route: null, requestType: 'local' },
    };
    ({ route, requestType } = localRoutes[fulfillmentChoice]);
  } else if (fulfillmentChoice === 'bt_customer_ship') {
    route = 'customer_ship';
  } else if (fulfillmentChoice === 'bt_customer_dropoff') {
    route = 'customer_dropoff';
    requestType = 'dropoff';
  } else {
    route = 'internal_transfer';
    if (fulfillmentChoice === 'bt_to_branch') {
      assertBranch(deliveryBranch, 'Delivery');
      if (deliveryBranch === homeBranch) {
        throw routingError('Delivery branch must be different from the stone home branch');
      }
      destination = deliveryBranch;
    }
  }

  return {
    fulfillmentBranch: homeBranch,
    deliveryBranch: destination,
    crossBranch: !isLocal,
    deliveryRoute: route,
    requestType,
  };
}

function legacyFulfillmentChoice({ homeBranch, repBranch, deliveryRoute }) {
  if (homeBranch === repBranch) {
    if (deliveryRoute === 'customer_ship') return 'local_ship';
    if (deliveryRoute === 'customer_dropoff') return 'local_dropoff';
    return 'local';
  }
  if (deliveryRoute === 'customer_ship') return 'bt_customer_ship';
  if (deliveryRoute === 'customer_dropoff') return 'bt_customer_dropoff';
  return 'bt_to_rep_branch';
}

module.exports = {
  homeBranchForStock,
  deriveRequestRoute,
  legacyFulfillmentChoice,
};
