const { normalizeStockStatus, stockStatusLabel } = require('./stockStatus');

const STOCK_TABLES = new Set(['loose_diamonds', 'jewelry_pieces']);

async function archiveBranchSnapshot(client, table, branch) {
  if (!STOCK_TABLES.has(table)) {
    throw new Error('Unsupported stock table');
  }
  const result = await client.query(
    `UPDATE ${table}
     SET snapshot_active = false,
         snapshot_missing_since = COALESCE(snapshot_missing_since, now()),
         updated_at = now()
     WHERE branch = $1 AND snapshot_active = true`,
    [branch]
  );
  return result.rowCount || 0;
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveSnapshotReconciliation({ request = {}, stock = {} }) {
  const snapshotActive = Boolean(stock.snapshotActive);
  const issuedAt = timestamp(request.erpTransferIssuedAt);
  const receivedAt = timestamp(request.erpTransferReceivedAt);
  const eventAt = receivedAt || issuedAt;

  if (!eventAt) {
    if (!snapshotActive) {
      return {
        state: 'missing',
        label: 'Not in latest ERP snapshot',
      };
    }
    return {
      state: 'current',
      label: 'Latest ERP snapshot',
    };
  }

  const observedAt = timestamp(
    snapshotActive ? stock.lastSeenAt : stock.snapshotMissingSince
  );
  if (!observedAt || observedAt < eventAt) {
    return {
      state: 'stale',
      label: 'Latest ERP snapshot predates the confirmed ERP action',
    };
  }

  let agrees;
  if (receivedAt) {
    agrees = snapshotActive && stock.branch === request.deliveryBranch;
  } else {
    agrees = !snapshotActive
      || normalizeStockStatus(stock.stockStatus) === 'in_transit';
  }

  if (agrees) {
    return {
      state: 'reconciled',
      label: 'Latest ERP snapshot agrees with the confirmed ERP movement',
    };
  }
  return {
    state: 'mismatch',
    label: 'Latest ERP snapshot needs inventory review',
  };
}

function buildTrackingSnapshotPresentation({ request = {}, stock = {} }) {
  const active = Boolean(stock.snapshotActive);
  const normalizedStatus = active && stock.stockStatus
    ? normalizeStockStatus(stock.stockStatus)
    : null;
  const normalizedStock = {
    snapshotActive: active,
    branch: stock.branch || null,
    stockStatus: normalizedStatus,
    lastSeenAt: stock.lastSeenAt || null,
    snapshotMissingSince: stock.snapshotMissingSince || null,
  };

  return {
    currentStockStatus: normalizedStatus,
    currentStockStatusLabel: active && normalizedStatus
      ? stockStatusLabel(normalizedStatus)
      : 'Not in latest ERP snapshot',
    snapshot: {
      active,
      branch: normalizedStock.branch,
      stockStatus: normalizedStatus,
      lastSeenAt: normalizedStock.lastSeenAt,
      missingSince: normalizedStock.snapshotMissingSince,
    },
    snapshotReconciliation: deriveSnapshotReconciliation({
      request,
      stock: normalizedStock,
    }),
  };
}

module.exports = {
  archiveBranchSnapshot,
  buildTrackingSnapshotPresentation,
  deriveSnapshotReconciliation,
};
