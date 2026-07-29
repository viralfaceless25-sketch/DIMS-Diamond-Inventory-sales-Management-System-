const { normalizeStockStatus } = require('./stockStatus');

function erpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertCrossBranch(request) {
  if (!request?.cross_branch) {
    throw erpError(400, 'ERP branch transfer actions require a cross-branch request');
  }
}

function assertErpTransferAction({
  request,
  actorRole,
  actorBranch,
  actorSalesRepId,
  action,
}) {
  assertCrossBranch(request);
  if (request.status === 'cancelled') {
    throw erpError(409, 'A cancelled request cannot accept ERP actions');
  }
  const sourceBranch = request.fulfillment_branch || request.branch;
  const destinationBranch = request.delivery_branch || request.branch;

  if (action === 'issue') {
    if (actorRole !== 'inventory' || actorBranch !== sourceBranch) {
      throw erpError(403, `Only ${sourceBranch} inventory can confirm ERP BT issue`);
    }
    return;
  }

  if (action === 'reject_unavailable') {
    if (actorRole !== 'inventory' || actorBranch !== sourceBranch) {
      throw erpError(403, `Only ${sourceBranch} inventory can reject this ERP BT`);
    }
    if (request.erp_transfer_confirmed) {
      throw erpError(409, 'The ERP branch transfer has already been issued');
    }
    return;
  }

  if (action === 'receive') {
    if (actorRole !== 'inventory' || actorBranch !== destinationBranch) {
      throw erpError(403, `Only ${destinationBranch} inventory can confirm ERP BT receipt`);
    }
    if (!request.erp_transfer_confirmed) {
      throw erpError(409, 'The branch transfer must be issued in ERP first');
    }
    return;
  }

  if (action === 'request_receive') {
    if (actorRole !== 'sales_rep' || actorSalesRepId !== request.sales_rep_id) {
      throw erpError(403, 'Only the request owner can ask inventory to receive this ERP BT');
    }
    if (!request.erp_transfer_confirmed) {
      throw erpError(409, 'The branch transfer must be issued in ERP first');
    }
    return;
  }

  throw erpError(400, 'Unknown ERP branch transfer action');
}

function buildErpUnavailableResolution({ liveStatus, reason } = {}) {
  const normalizedStatus = normalizeStockStatus(liveStatus);
  if (!liveStatus || normalizedStatus === 'available') {
    throw erpError(400, 'Choose the current unavailable ERP status');
  }
  const normalizedReason = String(reason || '').trim() || null;
  if (normalizedReason && normalizedReason.length > 500) {
    throw erpError(400, 'Reason cannot exceed 500 characters');
  }
  return {
    liveStatus: normalizedStatus,
    reason: normalizedReason,
  };
}

module.exports = { assertErpTransferAction, buildErpUnavailableResolution };
