const VALID_BRANCHES = new Set(['NY', 'LA', 'CH']);

function scopeError(message, status = 403) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Resolves which branch an inventory dashboard query is allowed to see.
//
// Each inventory room (stockny/stockla/stockch) owns exactly one branch, so it
// must only ever see requests, stats, and tracking rows where that branch is
// the requester, the supplying (fulfillment) branch, or the delivery branch.
// A NY room must never see an LA-local request. Client-supplied branch values
// (including "ALL") are deliberately ignored for inventory — the authenticated
// user's own branch is the single source of truth, so the scope cannot be
// widened by tampering with the query string.
function inventoryBranchScope(userBranch) {
  const branch = String(userBranch || '').trim().toUpperCase();
  if (!VALID_BRANCHES.has(branch)) {
    throw scopeError('Your inventory account is missing a valid branch');
  }
  return branch;
}

module.exports = { inventoryBranchScope, VALID_BRANCHES };
