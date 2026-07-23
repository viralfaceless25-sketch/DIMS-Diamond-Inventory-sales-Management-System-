const express = require('express');
const pool = require('../db/pool');
const { sortStones } = require('../services/sortingService');
const { computeBatchStatus, isActive } = require('../services/statusService');
const { deriveRequestStatus } = require('../services/resolutionService');
const { getHoldersMap } = require('../services/duplicateService');
const { isRequestableStockStatus, normalizeStockStatus, stockStatusLabel } = require('../services/stockStatus');
const { homeBranchForStock, deriveRequestRoute } = require('../services/requestRouting');
const {
  movementForStoneField,
  recordRequestMovement,
  recordStoneMovement,
} = require('../services/movementService');
const { broadcast } = require('../sockets');
const { withTransaction } = require('../db/withRetry');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Every route here requires a logged-in user. Role-specific guards are applied
// per-route below (inventory-only toggles vs rep-visible reads).
router.use(requireAuth);

// Joins a request_stones row with whichever stock table (loose/jewelry) it
// points at, so callers get shape/carat/color/clarity or category/item.
const STONE_DETAIL_SELECT = `
  SELECT
    rs.id, rs.request_id, rs.barcode, rs.item_type,
    rs.stone_found, rs.cert_found, rs.returned,
    rs.stone_found_at, rs.cert_found_at, rs.returned_at,
    ld.shape, COALESCE(ld.carat, jp.diamond_cts) AS carat, ld.color, ld.clarity, COALESCE(ld.certificate_no, jp.cert_no) AS cert_no,
    jp.category, jp.item
  FROM request_stones rs
  LEFT JOIN loose_diamonds ld ON ld.barcode = rs.barcode AND rs.item_type = 'loose'
  LEFT JOIN jewelry_pieces jp ON jp.barcode = rs.barcode AND rs.item_type = 'jewelry'
  WHERE rs.request_id = $1
`;

async function fetchStonesForRequest(requestId, queryable = pool) {
  const { rows } = await queryable.query(STONE_DETAIL_SELECT, [requestId]);
  return sortStones(rows);
}

function annotateDuplicates(stones, holdersMap, currentRepId) {
  return stones.map((s) => {
    const holders = holdersMap.get(s.barcode) || [];
    const otherReps = holders.filter((h) => h.repId !== currentRepId);
    const distinctReps = new Set(holders.map((h) => h.repId));
    return {
      ...s,
      duplicate: distinctReps.size > 1,
      duplicateWith: distinctReps.size > 1 ? otherReps.map((h) => h.repName) : [],
    };
  });
}

// Applies a stone mutation and recomputes/saves the batch status as ONE
// atomic transaction. The request row is locked first (SELECT ... FOR
// UPDATE), so two concurrent toggles on the SAME request serialize against
// each other — the second toggle's mutation and recompute see the first
// toggle's committed state, rather than both reading stale data and racing to
// write the `status` column independently. withTransaction additionally
// retries the whole thing on a CockroachDB SERIALIZABLE conflict.
async function inventoryBranch(userId) {
  const { rows } = await pool.query(
    `SELECT sr.branch FROM users u JOIN sales_reps sr ON sr.id = u.sales_rep_id WHERE u.id = $1`,
    [userId]
  );
  return rows[0]?.branch || null;
}

function assertFulfillmentStep(request, actorBranch) {
  if (!request.cross_branch) return;

  const route = request.delivery_route;
  const status = request.transfer_status || 'awaiting_source';
  const expectedBranch = route === 'internal_transfer' ? (request.delivery_branch || request.branch) : request.fulfillment_branch;
  const expectedStatus = route === 'internal_transfer' ? 'ready_for_rep' : 'packed';

  if (actorBranch !== expectedBranch || status !== expectedStatus) {
    const err = new Error(
      route === 'internal_transfer'
        ? 'Only destination inventory can confirm stones after the transfer is ready for the sales rep'
        : 'Only supplying inventory can confirm stones after the package is marked packed'
    );
    err.status = 409;
    throw err;
  }
}

async function applyStoneMutationAndRecompute(requestId, actorBranch, mutateFn) {
  return withTransaction(pool, async (client) => {
    const { rows: lockRows } = await client.query(
      `SELECT branch, fulfillment_branch, delivery_branch, cross_branch, delivery_route, transfer_status, request_scope
       FROM requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    if (lockRows.length === 0) {
      const err = new Error('Request not found');
      err.status = 404;
      throw err;
    }

    assertFulfillmentStep(lockRows[0], actorBranch);

    await mutateFn(client);

    const stones = await fetchStonesForRequest(requestId, client);
    const status = deriveRequestStatus(stones, lockRows[0].request_scope || 'stone_and_cert', false);
    await client.query('UPDATE requests SET status = $1, resolution_confirmed = false WHERE id = $2', [status, requestId]);

    return { stones, status, branch: lockRows[0].branch, fulfillmentBranch: lockRows[0].fulfillment_branch, crossBranch: lockRows[0].cross_branch };
  });
}

function normalizeBarcode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeItemType(value) {
  return value === 'jewelry' ? 'jewelry' : 'loose';
}

// GET /api/requests/stats?branch=ALL  (inventory dashboard only)
router.get('/stats', requireRole('inventory'), async (req, res, next) => {
  try {
    const { branch } = req.query;
    const params = [];
    let where = '';
    if (branch && branch !== 'ALL') {
      params.push(branch);
      where = 'WHERE branch = $1 OR fulfillment_branch = $1 OR delivery_branch = $1';
    }
    const { rows: reqRows } = await pool.query(
      `SELECT id, status FROM requests ${where}`,
      params
    );
    const pendingRequests = reqRows.filter((r) => r.status !== 'fulfilled').length;
    const fulfilledRequests = reqRows.filter((r) => r.status === 'fulfilled').length;

    const stoneParams = [];
    let stoneWhere = '';
    if (branch && branch !== 'ALL') {
      stoneParams.push(branch);
      stoneWhere = 'WHERE r.branch = $1 OR r.fulfillment_branch = $1 OR r.delivery_branch = $1';
    }
    const { rows: stoneCountRows } = await pool.query(
      `SELECT count(*) FROM request_stones rs JOIN requests r ON r.id = rs.request_id ${stoneWhere}`,
      stoneParams
    );

    const holdersMap = await getHoldersMap(branch);
    const distinctDuplicateBarcodes = [...holdersMap.entries()].filter(
      ([, holders]) => new Set(holders.map((h) => h.repId)).size > 1
    ).length;

    res.json({
      pendingRequests,
      stonesRequested: Number(stoneCountRows[0].count),
      duplicateFlags: distinctDuplicateBarcodes,
      fulfilledRequests,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/requests?branch=ALL&view=active|completed&sort=recent|most_stones&search=
// The dashboard's full cross-rep queue — inventory staff only. Sales reps use
// /by-rep/:repId (scoped to themselves) instead.
router.get('/', requireRole('inventory'), async (req, res, next) => {
  try {
    const { branch, view = 'active', sort = 'recent', search } = req.query;

    const params = [];
    const conditions = [];
    if (branch && branch !== 'ALL') {
      params.push(branch);
      conditions.push(`(r.branch = $${params.length} OR r.fulfillment_branch = $${params.length} OR r.delivery_branch = $${params.length})`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const idx = params.length;
      conditions.push(
        `(LOWER(sr.name) LIKE $${idx} OR EXISTS (
           SELECT 1 FROM request_stones rs2
           WHERE rs2.request_id = r.id
           AND (LOWER(rs2.barcode) LIKE $${idx})
         ))`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: requests } = await pool.query(
      `SELECT r.id, r.branch, r.fulfillment_branch, r.delivery_branch, r.cross_branch, r.delivery_route, r.paperwork_type, r.transfer_status, r.resolution_confirmed,
              r.erp_transfer_confirmed, r.erp_transfer_confirmed_at, r.erp_transfer_confirmed_by, r.requested_at, r.status, r.source,
              r.request_scope, r.request_type, r.dropoff_company, r.dropoff_address,
              EXISTS(SELECT 1 FROM request_shipping_labels l WHERE l.request_id = r.id) AS has_label,
              sr.id AS rep_id, sr.name AS rep_name
       FROM requests r
       JOIN sales_reps sr ON sr.id = r.sales_rep_id
       ${where}
       ORDER BY r.requested_at DESC`,
      params
    );

    const filtered = requests.filter((r) =>
      view === 'completed' ? !isActive(r.status) : isActive(r.status)
    );

    const holdersMap = await getHoldersMap(branch);

    const withStoneCounts = await Promise.all(
      filtered.map(async (r) => {
        const { rows: countRows } = await pool.query(
          'SELECT count(*) FROM request_stones WHERE request_id = $1',
          [r.id]
        );
        const { rows: dupRows } = await pool.query(
          'SELECT barcode FROM request_stones WHERE request_id = $1 AND returned = false',
          [r.id]
        );
        const hasDuplicate = dupRows.some((row) => {
          const holders = holdersMap.get(row.barcode) || [];
          return new Set(holders.map((h) => h.repId)).size > 1;
        });
        return {
          id: r.id,
          branch: r.branch,
          fulfillmentBranch: r.fulfillment_branch || r.branch,
          deliveryBranch: r.delivery_branch || r.branch,
          crossBranch: r.cross_branch,
          deliveryRoute: r.delivery_route,
          paperworkType: r.paperwork_type,
          transferStatus: r.transfer_status,
          erpTransferConfirmed: r.erp_transfer_confirmed,
          erpTransferConfirmedAt: r.erp_transfer_confirmed_at,
          erpTransferConfirmedBy: r.erp_transfer_confirmed_by,
          resolutionConfirmed: r.resolution_confirmed,
          hasLabel: r.has_label,
          requestedAt: r.requested_at,
          status: r.status,
          source: r.source,
          requestScope: r.request_scope,
          requestType: r.request_type,
          dropoffCompany: r.dropoff_company,
          dropoffAddress: r.dropoff_address,
          rep: { id: r.rep_id, name: r.rep_name },
          stoneCount: Number(countRows[0].count),
          hasDuplicate,
        };
      })
    );

    withStoneCounts.sort((a, b) => {
      if (sort === 'most_stones') return b.stoneCount - a.stoneCount;
      return new Date(b.requestedAt) - new Date(a.requestedAt);
    });

    res.json(withStoneCounts);
  } catch (err) {
    next(err);
  }
});

// GET /api/requests/:id  (expanded, with sorted + duplicate-annotated stones)
// A sales rep may only open their own request; inventory may open any.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT r.id, r.branch, r.fulfillment_branch, r.delivery_branch, r.cross_branch, r.delivery_route, r.paperwork_type, r.transfer_status, r.resolution_confirmed,
              r.erp_transfer_confirmed, r.erp_transfer_confirmed_at, r.erp_transfer_confirmed_by, r.requested_at, r.status, r.source,
              r.request_scope, r.request_type, r.dropoff_company, r.dropoff_address,
              EXISTS(SELECT 1 FROM request_shipping_labels l WHERE l.request_id = r.id) AS has_label,
              sr.id AS rep_id, sr.name AS rep_name
       FROM requests r JOIN sales_reps sr ON sr.id = r.sales_rep_id
       WHERE r.id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const request = rows[0];

    if (req.user.role === 'sales_rep' && request.rep_id !== req.user.salesRepId) {
      return res.status(403).json({ error: 'You do not have access to this request' });
    }

    const stones = await fetchStonesForRequest(id);
    const holdersMap = await getHoldersMap(request.branch);
    const annotated = annotateDuplicates(stones, holdersMap, request.rep_id);

    res.json({
      id: request.id,
      branch: request.branch,
      fulfillmentBranch: request.fulfillment_branch || request.branch,
      deliveryBranch: request.delivery_branch || request.branch,
      crossBranch: request.cross_branch,
      deliveryRoute: request.delivery_route,
      paperworkType: request.paperwork_type,
      transferStatus: request.transfer_status,
      erpTransferConfirmed: request.erp_transfer_confirmed,
      erpTransferConfirmedAt: request.erp_transfer_confirmed_at,
      erpTransferConfirmedBy: request.erp_transfer_confirmed_by,
      resolutionConfirmed: request.resolution_confirmed,
      hasLabel: request.has_label,
      requestedAt: request.requested_at,
      status: request.status,
      source: request.source,
      requestScope: request.request_scope,
      requestType: request.request_type,
      dropoffCompany: request.dropoff_company,
      dropoffAddress: request.dropoff_address,
      rep: { id: request.rep_id, name: request.rep_name },
      stones: annotated,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/requests  — sales rep submits a new batch
// body: { branch, stones: [{ barcode, itemType }], source }
// The rep's identity comes from the auth token, never the request body — a
// rep can only ever create requests as themselves. Inventory staff aren't
// reps, so they can't use this endpoint.
router.post('/', requireRole('sales_rep'), async (req, res, next) => {
  try {
    const { stones, source = 'manual' } = req.body;
    const requestScope = ['stone_and_cert', 'stone_only', 'cert_only'].includes(req.body.requestScope) ? req.body.requestScope : 'stone_and_cert';
    const requestedDeliveryRoute = ['internal_transfer', 'customer_ship', 'customer_dropoff'].includes(req.body.deliveryRoute)
      ? req.body.deliveryRoute
      : 'internal_transfer';
    const paperworkType = ['none', 'pending', 'invoice', 'memo'].includes(req.body.paperworkType) ? req.body.paperworkType : 'none';
    const salesRepId = req.user.salesRepId;
    if (!salesRepId) {
      return res.status(400).json({ error: 'Your account is not linked to a sales rep profile' });
    }
    if (!Array.isArray(stones) || stones.length === 0) {
      return res.status(400).json({ error: 'A non-empty stones[] list is required' });
    }

    const { rows: repRows } = await pool.query('SELECT branch FROM sales_reps WHERE id = $1', [salesRepId]);
    const repBranch = repRows[0]?.branch;
    if (!repBranch) {
      return res.status(400).json({ error: 'Your sales rep profile is missing a branch' });
    }
    const normalizedStones = [];
    const seen = new Set();
    for (const stone of stones) {
      const barcode = normalizeBarcode(stone.barcode);
      const itemType = normalizeItemType(stone.itemType);
      if (!barcode) continue;
      const key = `${itemType}:${barcode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalizedStones.push({ barcode, itemType });
    }
    if (normalizedStones.length === 0) {
      return res.status(400).json({ error: 'At least one valid barcode is required' });
    }

    const looseBarcodes = normalizedStones.filter((s) => s.itemType === 'loose').map((s) => s.barcode);
    const jewelryBarcodes = normalizedStones.filter((s) => s.itemType === 'jewelry').map((s) => s.barcode);
    const stockByKey = new Map();
    if (looseBarcodes.length) {
      const { rows } = await pool.query(
        `SELECT barcode, branch, stock_status, 'loose' AS item_type FROM loose_diamonds WHERE barcode = ANY($1)`,
        [looseBarcodes]
      );
      for (const row of rows) stockByKey.set(`loose:${row.barcode}`, row);
    }
    if (jewelryBarcodes.length) {
      const { rows } = await pool.query(
        `SELECT barcode, branch, stock_status, 'jewelry' AS item_type FROM jewelry_pieces WHERE barcode = ANY($1)`,
        [jewelryBarcodes]
      );
      for (const row of rows) stockByKey.set(`jewelry:${row.barcode}`, row);
    }

    const blocked = [];
    for (const stone of normalizedStones) {
      const stock = stockByKey.get(`${stone.itemType}:${stone.barcode}`);
      if (!stock) {
        blocked.push(`${stone.barcode} is not in stock`);
        continue;
      }
      const status = normalizeStockStatus(stock.stock_status);
      if (!isRequestableStockStatus(status)) {
        blocked.push(`${stone.barcode} is ${stockStatusLabel(status)}`);
      }
    }
    if (blocked.length) {
      return res.status(409).json({
        error: `Request blocked: ${blocked.slice(0, 5).join('; ')}${blocked.length > 5 ? `; +${blocked.length - 5} more` : ''}`,
        blocked,
      });
    }

    let fulfillmentBranch;
    let deliveryBranch;
    let crossBranch;
    let deliveryRoute;
    let requestType;
    try {
      const homeBranch = homeBranchForStock(normalizedStones.map((stone) => ({
        barcode: stone.barcode,
        branch: stockByKey.get(`${stone.itemType}:${stone.barcode}`).branch,
      })));
      ({
        fulfillmentBranch,
        deliveryBranch,
        crossBranch,
        deliveryRoute,
        requestType,
      } = deriveRequestRoute({
        homeBranch,
        repBranch,
        deliveryRoute: requestedDeliveryRoute,
      }));
    } catch (routingError) {
      return res.status(409).json({ error: routingError.message });
    }

    const dropoffCompany = requestType === 'dropoff' ? String(req.body.dropoffCompany || '').trim() : null;
    const dropoffAddress = requestType === 'dropoff' ? String(req.body.dropoffAddress || '').trim() : null;
    if (requestType === 'dropoff' && (!dropoffCompany || !dropoffAddress)) {
      return res.status(400).json({ error: 'Drop-off company and address are required for drop-off requests' });
    }

    const holdersMap = await getHoldersMap(fulfillmentBranch);
    for (const stone of normalizedStones) {
      const holders = holdersMap.get(stone.barcode) || [];
      if (holders.length > 0) {
        const names = [...new Set(holders.map((h) => h.repName))].join(', ');
        blocked.push(`${stone.barcode} is already requested by ${names}`);
      }
    }
    if (blocked.length) {
      return res.status(409).json({
        error: `Request blocked: ${blocked.slice(0, 5).join('; ')}${blocked.length > 5 ? `; +${blocked.length - 5} more` : ''}`,
        blocked,
      });
    }

    // Only the actual write is retried on a CockroachDB serialization
    // conflict — the validation above is read-only and safe to have run once.
    const requestId = await withTransaction(pool, async (client) => {
      const { rows: reqRows } = await client.query(
        `INSERT INTO requests (sales_rep_id, branch, fulfillment_branch, delivery_branch, cross_branch, delivery_route, paperwork_type, transfer_status, source, request_scope, request_type, dropoff_company, dropoff_address, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'awaiting') RETURNING id`,
        [salesRepId, repBranch, fulfillmentBranch, deliveryBranch, crossBranch, deliveryRoute, paperworkType, deliveryRoute ? 'awaiting_source' : null, source === 'invoice_upload' ? 'invoice_upload' : 'manual', requestScope, requestType, dropoffCompany, dropoffAddress]
      );
      const newRequestId = reqRows[0].id;

      for (const stone of normalizedStones) {
        await client.query(
          `INSERT INTO request_stones (request_id, barcode, item_type)
           VALUES ($1, $2, $3)`,
          [newRequestId, stone.barcode, stone.itemType]
        );
      }
      await recordRequestMovement(client, newRequestId, {
        movementType: 'requested',
        fromBranch: fulfillmentBranch,
        toBranch: deliveryBranch,
        actorId: req.user.id,
        details: { deliveryRoute, requestType },
      });
      return newRequestId;
    });

    const stonesFull = await fetchStonesForRequest(requestId);
    broadcast(repBranch, 'request:created', { requestId, branch: repBranch });
    if (crossBranch) {
      broadcast(fulfillmentBranch, 'request:created', { requestId, branch: fulfillmentBranch, destinationBranch: deliveryBranch });
      if (deliveryBranch !== fulfillmentBranch && deliveryBranch !== repBranch) broadcast(deliveryBranch, 'request:created', { requestId, branch: deliveryBranch, sourceBranch: fulfillmentBranch });
    }

    res.status(201).json({ id: requestId, branch: repBranch, fulfillmentBranch, deliveryBranch, crossBranch, deliveryRoute, stones: stonesFull, status: 'awaiting' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/requests/:id/stones/:stoneId
// body: { field: 'stone_found' | 'cert_found' | 'returned', value: boolean }
// Only inventory staff fulfill/return stones. Reps see this state read-only.
router.patch('/:id/stones/:stoneId', requireRole('inventory'), async (req, res, next) => {
  try {
    const { id, stoneId } = req.params;
    const { field, value } = req.body;
    const allowedFields = ['stone_found', 'cert_found', 'returned'];
    if (!allowedFields.includes(field) || typeof value !== 'boolean') {
      return res.status(400).json({ error: `field must be one of ${allowedFields.join(', ')}, value must be boolean` });
    }

    const timestampCol = `${field}_at`;
    const actorBranch = await inventoryBranch(req.user.id);
    if (!actorBranch) return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    const { stones, status, branch, fulfillmentBranch, crossBranch } = await applyStoneMutationAndRecompute(id, actorBranch, async (client) => {
      const { rows: changedRows } = await client.query(
        `UPDATE request_stones SET ${field} = $1, ${timestampCol} = CASE WHEN $1 THEN now() ELSE NULL END
         WHERE id = $2 AND request_id = $3 AND ${field} IS DISTINCT FROM $1
         RETURNING id`,
        [value, stoneId, id]
      );
      if (value && changedRows[0]) {
        await recordStoneMovement(client, {
          requestId: Number(id),
          requestStoneId: Number(stoneId),
          movementType: movementForStoneField(field),
          fromBranch: actorBranch,
          toBranch: actorBranch,
          actorId: req.user.id,
        });
      }
    });

    broadcast(branch, 'request:updated', { requestId: Number(id), status });
    if (crossBranch) broadcast(fulfillmentBranch, 'request:updated', { requestId: Number(id), status });
    if (status === 'fulfilled') {
      broadcast(branch, 'request:completed', { requestId: Number(id) });
    }

    res.json({ id: Number(id), status, stones });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/requests/:id/check-all
// body: { value: boolean } — sets stone_found AND cert_found on every stone
// Inventory staff only.
router.patch('/:id/check-all', requireRole('inventory'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { value, field } = req.body;
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'value must be boolean' });
    }
    if (field && !['stone_found', 'cert_found', 'returned'].includes(field)) {
      return res.status(400).json({ error: 'field must be stone_found, cert_found, or returned' });
    }

    const actorBranch = await inventoryBranch(req.user.id);
    if (!actorBranch) return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    const { stones, status, branch, fulfillmentBranch, crossBranch } = await applyStoneMutationAndRecompute(id, actorBranch, async (client) => {
      const { rows: scopeRows } = await client.query('SELECT request_scope FROM requests WHERE id = $1', [id]);
      const requestScope = scopeRows[0]?.request_scope || 'stone_and_cert';
      const { rows: beforeRows } = await client.query(
        'SELECT id, stone_found, cert_found, returned FROM request_stones WHERE request_id = $1',
        [id]
      );

      if (field) {
        const timestampCol = `${field}_at`;
        await client.query(
          `UPDATE request_stones SET ${field} = $1, ${timestampCol} = CASE WHEN $1 THEN now() ELSE NULL END WHERE request_id = $2`,
          [value, id]
        );
      } else if (requestScope === 'stone_only') {
        await client.query(
          `UPDATE request_stones
           SET stone_found = $1,
               stone_found_at = CASE WHEN $1 THEN now() ELSE NULL END
           WHERE request_id = $2`,
          [value, id]
        );
      } else if (requestScope === 'cert_only') {
        await client.query(
          `UPDATE request_stones
           SET cert_found = $1,
               cert_found_at = CASE WHEN $1 THEN now() ELSE NULL END
           WHERE request_id = $2`,
          [value, id]
        );
      } else {
        await client.query(
          `UPDATE request_stones
           SET stone_found = $1, cert_found = $1,
               stone_found_at = CASE WHEN $1 THEN now() ELSE NULL END,
               cert_found_at = CASE WHEN $1 THEN now() ELSE NULL END
           WHERE request_id = $2`,
          [value, id]
        );
      }

      if (value) {
        const fields = field
          ? [field]
          : requestScope === 'stone_only'
            ? ['stone_found']
            : requestScope === 'cert_only'
              ? ['cert_found']
              : ['stone_found', 'cert_found'];
        for (const before of beforeRows) {
          for (const changedField of fields) {
            if (before[changedField]) continue;
            await recordStoneMovement(client, {
              requestId: Number(id),
              requestStoneId: before.id,
              movementType: movementForStoneField(changedField),
              fromBranch: actorBranch,
              toBranch: actorBranch,
              actorId: req.user.id,
            });
          }
        }
      }
    });

    broadcast(branch, 'request:updated', { requestId: Number(id), status });
    if (crossBranch) broadcast(fulfillmentBranch, 'request:updated', { requestId: Number(id), status });
    if (status === 'fulfilled') {
      broadcast(branch, 'request:completed', { requestId: Number(id) });
    }

    res.json({ id: Number(id), status, stones });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/requests/by-rep/:repId  — powers the Sales Rep app's "My requests"
// A sales rep may only read their own; inventory may read any rep's.
// Checkbox updates only record that inventory found an item. A separate
// confirmation is required before the request leaves the active queue.
router.patch('/:id/confirm-resolution', requireRole('inventory'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Valid request is required' });
    const actorBranch = await inventoryBranch(req.user.id);
    if (!actorBranch) return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT branch, fulfillment_branch, cross_branch, delivery_route, transfer_status, request_scope
         FROM requests WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!rows[0]) { const err = new Error('Request not found'); err.status = 404; throw err; }
      assertFulfillmentStep(rows[0], actorBranch);
      const stones = await fetchStonesForRequest(id, client);
      const status = deriveRequestStatus(stones, rows[0].request_scope, true);
      await client.query('UPDATE requests SET status = $1, resolution_confirmed = true WHERE id = $2', [status, id]);
      return { stones, branch: rows[0].branch, fulfillmentBranch: rows[0].fulfillment_branch, crossBranch: rows[0].cross_branch };
    });
    broadcast(result.branch, 'request:completed', { requestId: id });
    if (result.crossBranch) broadcast(result.fulfillmentBranch, 'request:completed', { requestId: id });
    res.json({ id, status: 'fulfilled', stones: result.stones, resolutionConfirmed: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/by-rep/:repId', async (req, res, next) => {
  try {
    const { repId } = req.params;
    if (req.user.role === 'sales_rep' && Number(repId) !== req.user.salesRepId) {
      return res.status(403).json({ error: 'You can only view your own requests' });
    }
    const { rows: requests } = await pool.query(
      `SELECT id, branch, fulfillment_branch, delivery_branch, cross_branch, delivery_route, paperwork_type, transfer_status,
              erp_transfer_confirmed, erp_transfer_confirmed_at, erp_transfer_confirmed_by,
              requested_at, status, request_scope, request_type, dropoff_company, dropoff_address,
              EXISTS(SELECT 1 FROM request_shipping_labels l WHERE l.request_id = requests.id) AS has_label FROM requests
       WHERE sales_rep_id = $1 ORDER BY requested_at DESC`,
      [repId]
    );
    const withStones = await Promise.all(
      requests.map(async (r) => {
        const stones = await fetchStonesForRequest(r.id);
        return {
          id: r.id,
          branch: r.branch,
          fulfillmentBranch: r.fulfillment_branch || r.branch,
          deliveryBranch: r.delivery_branch || r.branch,
          crossBranch: r.cross_branch,
          deliveryRoute: r.delivery_route,
          paperworkType: r.paperwork_type,
          transferStatus: r.transfer_status,
          erpTransferConfirmed: r.erp_transfer_confirmed,
          erpTransferConfirmedAt: r.erp_transfer_confirmed_at,
          erpTransferConfirmedBy: r.erp_transfer_confirmed_by,
          hasLabel: r.has_label,
          requestedAt: r.requested_at,
          status: r.status,
          requestScope: r.request_scope,
          requestType: r.request_type,
          dropoffCompany: r.dropoff_company,
          dropoffAddress: r.dropoff_address,
          stones,
        };
      })
    );
    res.json(withStones);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
