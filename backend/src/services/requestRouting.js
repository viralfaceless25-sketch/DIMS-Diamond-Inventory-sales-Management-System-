const VALID_BRANCHES = new Set(['NY', 'LA', 'CH']);
const VALID_DELIVERY_ROUTES = new Set([
  'internal_transfer',
  'customer_ship',
  'customer_dropoff',
]);

function assertBranch(branch, description) {
  if (!VALID_BRANCHES.has(branch)) {
    throw new Error(`${description} is not a recognized home branch`);
  }
}

function homeBranchForStock(stones) {
  if (!Array.isArray(stones) || stones.length === 0) {
    throw new Error('At least one stone with a home branch is required');
  }

  const branches = new Set();
  for (const stone of stones) {
    const branch = String(stone?.branch || '').trim().toUpperCase();
    assertBranch(branch, `Stone ${stone?.barcode || ''}`.trim());
    branches.add(branch);
  }

  if (branches.size !== 1) {
    throw new Error('Each request must contain stones from one home branch; submit the current request before requesting another branch');
  }

  return [...branches][0];
}

function deriveRequestRoute({ homeBranch, repBranch, deliveryRoute }) {
  assertBranch(homeBranch, 'Stone');
  assertBranch(repBranch, 'Sales rep');

  const route = deliveryRoute || 'internal_transfer';
  if (!VALID_DELIVERY_ROUTES.has(route)) {
    throw new Error('Choose Ship to my branch, Ship directly to customer, or Sales rep drop-off');
  }

  const crossBranch = homeBranch !== repBranch;
  const requestType = route === 'customer_dropoff'
    ? 'dropoff'
    : route === 'customer_ship' || crossBranch
      ? 'ship'
      : 'pickup';

  return {
    fulfillmentBranch: homeBranch,
    deliveryBranch: repBranch,
    crossBranch,
    deliveryRoute: crossBranch || route !== 'internal_transfer' ? route : null,
    requestType,
  };
}

module.exports = {
  homeBranchForStock,
  deriveRequestRoute,
};
