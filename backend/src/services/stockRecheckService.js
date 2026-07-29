const { normalizeStockStatus } = require('./stockStatus');

const STOCK_TABLE_BY_ITEM_TYPE = {
  loose: 'loose_diamonds',
  jewelry: 'jewelry_pieces',
};

function recheckError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertStockRecheckVerification({
  recheck,
  actorRole,
  actorBranch,
}) {
  if (!recheck) {
    throw recheckError(404, 'Stock recheck not found');
  }
  if (actorRole !== 'inventory') {
    throw recheckError(403, 'Stock recheck verification requires inventory access');
  }
  if (!actorBranch || actorBranch !== recheck.home_branch) {
    throw recheckError(403, `Only ${recheck.home_branch} inventory can verify this stock recheck`);
  }
  if (recheck.state !== 'pending') {
    throw recheckError(409, 'This stock recheck has already been resolved');
  }
}

function normalizeStockRecheckInput(input = {}) {
  const barcode = String(input.barcode || '').trim().toUpperCase();
  if (!barcode) throw recheckError(400, 'Barcode is required');
  if (barcode.length > 64) throw recheckError(400, 'Barcode cannot exceed 64 characters');
  if (!['loose', 'jewelry'].includes(input.itemType)) {
    throw recheckError(400, 'Item type must be loose or jewelry');
  }
  return { barcode, itemType: input.itemType };
}

function buildStockRecheckResolution({
  decision,
  liveStatus,
  note,
} = {}) {
  const normalizedNote = String(note || '').trim() || null;
  if (normalizedNote && normalizedNote.length > 500) {
    throw recheckError(400, 'Note cannot exceed 500 characters');
  }
  if (decision === 'available') {
    return {
      state: 'verified_available',
      verifiedStatus: 'available',
      note: normalizedNote,
    };
  }
  if (decision === 'unavailable') {
    const verifiedStatus = normalizeStockStatus(liveStatus);
    if (!liveStatus || verifiedStatus === 'available') {
      throw recheckError(400, 'Choose the current unavailable status');
    }
    return {
      state: 'verified_unavailable',
      verifiedStatus,
      note: normalizedNote,
    };
  }
  throw recheckError(400, 'Decision must be available or unavailable');
}

function buildRequestAvailabilityVerification(row = {}) {
  if (!row.live_recheck_id) return null;
  return {
    id: row.live_recheck_id,
    snapshotStatus: row.live_recheck_snapshot_status,
    snapshotActive: row.live_recheck_snapshot_active,
    snapshotLastSeenAt: row.live_recheck_snapshot_last_seen_at,
    verifiedStatus: 'available',
    verifiedAt: row.live_recheck_verified_at,
    verifiedBy: row.live_recheck_verified_by,
    verifierEmail: row.live_recheck_verifier_email || null,
  };
}

async function loadLockedStockForRecheck(client, { barcode, itemType }) {
  const table = STOCK_TABLE_BY_ITEM_TYPE[itemType];
  if (!table) throw recheckError(400, 'Item type must be loose or jewelry');
  const { rows } = await client.query(
    `SELECT barcode, branch, stock_status, snapshot_active, last_seen_at,
            snapshot_missing_since, '${itemType}' AS item_type
     FROM ${table}
     WHERE barcode = $1
     FOR UPDATE`,
    [barcode]
  );
  return rows[0] || null;
}

async function createOrReuseStockRecheck(client, {
  salesRepId,
  barcode,
  itemType,
}) {
  const stock = await loadLockedStockForRecheck(client, { barcode, itemType });
  if (!stock) throw recheckError(404, 'Stone is not present in preserved stock history');
  if (stock.snapshot_active !== false
      && normalizeStockStatus(stock.stock_status) === 'available') {
    throw recheckError(409, 'This stone is already available in the latest ERP snapshot');
  }

  const { rows: existingRows } = await client.query(
    `SELECT id, sales_rep_id, barcode, item_type, home_branch, snapshot_status,
            snapshot_active, snapshot_last_seen_at, state, verified_status,
            requested_at, verified_at, verified_by, note, consumed_at,
            consumed_request_id
     FROM stock_recheck_requests
     WHERE sales_rep_id = $1
       AND barcode = $2
       AND item_type = $3
       AND state IN ('pending', 'verified_available')
     ORDER BY requested_at DESC, id DESC
     FOR UPDATE`,
    [salesRepId, barcode, itemType]
  );
  const pending = existingRows.find((row) => row.state === 'pending');
  if (pending) return { recheck: pending, reused: true, stock };

  const validAuthorization = existingRows.find((row) => (
    isAvailabilityAuthorizationUsable({
      authorization: row,
      stock,
      stone: { barcode, itemType },
      salesRepId,
    })
  ));
  if (validAuthorization) {
    return { recheck: validAuthorization, reused: true, stock };
  }

  const { rows } = await client.query(
    `INSERT INTO stock_recheck_requests (
       sales_rep_id, barcode, item_type, home_branch, snapshot_status,
       snapshot_active, snapshot_last_seen_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      salesRepId,
      barcode,
      itemType,
      stock.branch,
      normalizeStockStatus(stock.stock_status),
      stock.snapshot_active !== false,
      stock.last_seen_at || null,
    ]
  );
  return { recheck: rows[0], reused: false, stock };
}

async function resolveStockRecheck(client, {
  recheckId,
  actorRole,
  actorBranch,
  actorId,
  resolution,
}) {
  const { rows: lookupRows } = await client.query(
    `SELECT id, sales_rep_id, barcode, item_type, home_branch, state
     FROM stock_recheck_requests
     WHERE id = $1`,
    [recheckId]
  );
  const lookup = lookupRows[0];
  if (!lookup) throw recheckError(404, 'Stock recheck not found');

  const stock = await loadLockedStockForRecheck(client, {
    barcode: lookup.barcode,
    itemType: lookup.item_type,
  });
  if (!stock || stock.branch !== lookup.home_branch) {
    throw recheckError(
      409,
      'The stone home branch changed after this recheck was requested; submit a new recheck'
    );
  }

  const { rows: lockedRows } = await client.query(
    `SELECT id, sales_rep_id, barcode, item_type, home_branch, state
     FROM stock_recheck_requests
     WHERE id = $1
     FOR UPDATE`,
    [recheckId]
  );
  const recheck = lockedRows[0];
  assertStockRecheckVerification({ recheck, actorRole, actorBranch });

  const { rows } = await client.query(
    `UPDATE stock_recheck_requests
     SET state = $2, verified_status = $3, note = $4,
         verified_by = $5, verified_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      recheckId,
      resolution.state,
      resolution.verifiedStatus,
      resolution.note,
      actorId,
    ]
  );
  return rows[0];
}

function timeValue(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isAvailabilityAuthorizationUsable({
  authorization,
  stock,
  stone,
  salesRepId,
}) {
  if (!authorization || !stock || !stone) return false;
  if (authorization.state !== 'verified_available' || authorization.consumed_at) return false;
  if (Number(authorization.sales_rep_id) !== Number(salesRepId)) return false;
  if (authorization.barcode !== stone.barcode) return false;
  if (authorization.item_type !== stone.itemType) return false;
  if (authorization.home_branch !== stock.branch) return false;
  if (normalizeStockStatus(authorization.verified_status) !== 'available') return false;

  const verifiedAt = timeValue(authorization.verified_at);
  const snapshotAt = timeValue(stock.last_seen_at);
  return Boolean(verifiedAt && (!snapshotAt || verifiedAt > snapshotAt));
}

async function loadLockedAvailabilityAuthorizations(client, salesRepId, stones) {
  const barcodes = [...new Set(stones.map((stone) => stone.barcode))].sort();
  if (!barcodes.length) return new Map();

  const { rows } = await client.query(
    `SELECT id, sales_rep_id, barcode, item_type, home_branch, state,
            verified_status, verified_at, consumed_at
     FROM stock_recheck_requests
     WHERE sales_rep_id = $1
       AND barcode = ANY($2)
       AND state = 'verified_available'
       AND consumed_at IS NULL
     ORDER BY item_type, barcode, verified_at DESC, id DESC FOR UPDATE`,
    [salesRepId, barcodes]
  );

  const requested = new Set(
    stones.map((stone) => `${stone.itemType}:${stone.barcode}`)
  );
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.item_type}:${row.barcode}`;
    if (requested.has(key) && !byKey.has(key)) byKey.set(key, row);
  }
  return byKey;
}

async function consumeAvailabilityAuthorizations(client, authorizationIds, requestId) {
  const ids = [...new Set(authorizationIds.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!ids.length) return;
  const result = await client.query(
    `UPDATE stock_recheck_requests
     SET state = 'consumed', consumed_at = now(), consumed_request_id = $2
     WHERE id = ANY($1)
       AND state = 'verified_available'
       AND consumed_at IS NULL`,
    [ids, requestId]
  );
  if (result.rowCount !== ids.length) {
    throw recheckError(409, 'Live ERP availability verification is no longer available; request another recheck');
  }
}

module.exports = {
  assertStockRecheckVerification,
  buildRequestAvailabilityVerification,
  buildStockRecheckResolution,
  consumeAvailabilityAuthorizations,
  createOrReuseStockRecheck,
  isAvailabilityAuthorizationUsable,
  loadLockedAvailabilityAuthorizations,
  normalizeStockRecheckInput,
  resolveStockRecheck,
};
