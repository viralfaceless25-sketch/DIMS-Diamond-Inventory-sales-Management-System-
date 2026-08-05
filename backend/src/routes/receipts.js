const express = require('express');
const pool = require('../db/pool');
const { withTransaction } = require('../db/withRetry');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  VALID_BRANCHES,
  assertHandoffAllowed,
  assertReceiptCorrectionAllowed,
  branchLocalDate,
  duplicateComponents,
  nextPhysicalStatus,
  normalizeBarcode,
  normalizeReceiptInput,
  receiptRollup,
  receiptStatusLabel,
  selectReceiptCandidate,
} = require('../services/receiptService');
const {
  buildReceiptWorkbook,
  receiptExportFilename,
} = require('../services/receiptExportService');
const {
  recordRequestMovement,
  recordStoneMovement,
} = require('../services/movementService');
const { broadcast } = require('../sockets');
const { parseId } = require('../utils/requestParams');

const router = express.Router();
router.use(requireAuth, requireRole('inventory'));

function routeError(message, status = 400, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

async function inventoryBranch(queryable, userId) {
  const { rows } = await queryable.query(
    `SELECT sr.branch FROM users u
     JOIN sales_reps sr ON sr.id = u.sales_rep_id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0]?.branch || null;
}

function parseReceiptDate(value, branch) {
  if (value == null || value === '') return branchLocalDate(branch);
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw routeError('Date must use YYYY-MM-DD');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw routeError('Date must be a real calendar date');
  }
  return date;
}

function mapCandidate(row) {
  return {
    requestId: Number(row.request_id),
    requestStoneId: Number(row.request_stone_id),
    barcode: row.barcode,
    itemType: row.item_type,
    sourceBranch: row.source_branch,
    destinationBranch: row.destination_branch,
    requestScope: row.request_scope,
    transferStatus: row.transfer_status || 'awaiting_source',
    requestStatus: row.request_status,
    erpTransferConfirmed: Boolean(row.erp_transfer_confirmed),
    erpTransferReceived: Boolean(row.erp_transfer_received),
    rep: {
      id: Number(row.rep_id),
      name: row.rep_name,
    },
  };
}

async function findCandidates(queryable, {
  receivingBranch,
  barcode,
  forUpdate = false,
}) {
  const { rows } = await queryable.query(
    `SELECT r.id AS request_id, rs.id AS request_stone_id,
            UPPER(rs.barcode) AS barcode, rs.item_type,
            r.fulfillment_branch AS source_branch,
            COALESCE(r.delivery_branch, r.branch) AS destination_branch,
            r.request_scope, r.transfer_status, r.status AS request_status,
            r.erp_transfer_confirmed, r.erp_transfer_received,
            sr.id AS rep_id, sr.name AS rep_name
     FROM requests r
     JOIN request_stones rs ON rs.request_id = r.id
     JOIN sales_reps sr ON sr.id = r.sales_rep_id
     WHERE UPPER(rs.barcode) = $1
       AND COALESCE(r.delivery_branch, r.branch) = $2
       AND r.cross_branch = true
       AND r.delivery_route = 'internal_transfer'
       AND r.status <> 'cancelled'
       AND COALESCE(r.transfer_status, 'awaiting_source') <> 'handed_to_rep'
     ORDER BY r.requested_at, r.id, rs.id
     ${forUpdate ? 'FOR UPDATE OF r, rs' : ''}`,
    [barcode, receivingBranch]
  );
  return rows.map(mapCandidate);
}

// When no candidate matches at this receiving branch, this looks for the
// same barcode's active internal-transfer request routed to a DIFFERENT
// branch (or a request that isn't a receivable branch shipment at all —
// local pickup, or shipped/dropped directly to a customer). Surfacing this
// turns a dead-end "no matching request" into an actionable diagnostic for
// every branch: the CH room can see a request was actually sent to LA
// instead of a silent miss, without inventory needing database access.
async function findElsewhereMatch(queryable, { receivingBranch, barcode }) {
  const { rows } = await queryable.query(
    `SELECT r.id AS request_id, r.cross_branch, r.delivery_route,
            r.fulfillment_branch AS source_branch,
            COALESCE(r.delivery_branch, r.branch) AS destination_branch,
            sr.id AS rep_id, sr.name AS rep_name
     FROM requests r
     JOIN request_stones rs ON rs.request_id = r.id
     JOIN sales_reps sr ON sr.id = r.sales_rep_id
     WHERE UPPER(rs.barcode) = $1
       AND r.status <> 'cancelled'
       AND COALESCE(r.transfer_status, 'awaiting_source') <> 'handed_to_rep'
       AND NOT (
         COALESCE(r.delivery_branch, r.branch) = $2
         AND r.cross_branch = true
         AND r.delivery_route = 'internal_transfer'
       )
     ORDER BY r.requested_at DESC
     LIMIT 1`,
    [barcode, receivingBranch]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    requestId: Number(row.request_id),
    sourceBranch: row.source_branch,
    destinationBranch: row.cross_branch ? row.destination_branch : row.source_branch,
    receivableAtABranch: row.cross_branch && row.delivery_route === 'internal_transfer',
    rep: { id: Number(row.rep_id), name: row.rep_name },
  };
}

async function findPreviousReceipts(queryable, receivingBranch, barcode) {
  const { rows } = await queryable.query(
    `SELECT sh.id, sh.request_id, sh.request_stone_id, sh.barcode,
            sh.stone_received, sh.cert_received, sh.match_state,
            sh.source_branch, sh.received_on, sh.received_at,
            u.email AS received_by_email
     FROM shipment_receipts sh
     JOIN users u ON u.id = sh.received_by
     WHERE sh.receiving_branch = $1 AND sh.barcode = $2
     ORDER BY sh.received_at DESC, sh.id DESC
     LIMIT 50`,
    [receivingBranch, barcode]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    requestId: row.request_id == null ? null : Number(row.request_id),
    requestStoneId: row.request_stone_id == null ? null : Number(row.request_stone_id),
    barcode: row.barcode,
    stoneReceived: row.stone_received,
    certReceived: row.cert_received,
    matchState: row.match_state,
    sourceBranch: row.source_branch,
    receivedOn: row.received_on,
    receivedAt: row.received_at,
    receivedByEmail: row.received_by_email,
  }));
}

async function loadRequestAndRollup(queryable, requestId, { forUpdate = false } = {}) {
  const { rows: requestRows } = await queryable.query(
    `SELECT r.id, r.status, r.transfer_status, r.delivery_route,
            r.fulfillment_branch,
            COALESCE(r.delivery_branch, r.branch) AS destination_branch,
            r.sales_rep_id, r.request_scope
     FROM requests r
     WHERE r.id = $1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [requestId]
  );
  const request = requestRows[0];
  if (!request) throw routeError('Request not found', 404);

  const { rows: stones } = await queryable.query(
    `SELECT rs.id, r.request_scope
     FROM request_stones rs
     JOIN requests r ON r.id = rs.request_id
     WHERE rs.request_id = $1
     ORDER BY rs.id`,
    [requestId]
  );
  const { rows: receipts } = await queryable.query(
    `SELECT request_stone_id, stone_received, cert_received
     FROM shipment_receipts
     WHERE request_id = $1 AND match_state = 'matched'
     ORDER BY received_at, id`,
    [requestId]
  );
  return { request, rollup: receiptRollup(stones, receipts) };
}

async function writeReceiptAudit(queryable, {
  actorId,
  action,
  targetType,
  targetId,
  ip,
  details = {},
}) {
  await queryable.query(
    `INSERT INTO audit_log
       (actor_id, action, target_type, target_id, ip_address, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      actorId,
      action,
      targetType,
      targetId == null ? null : String(targetId),
      ip || null,
      JSON.stringify(details),
    ]
  );
}

async function recomputePhysicalProgress(queryable, {
  requestId,
  actorId,
}) {
  const { request, rollup } = await loadRequestAndRollup(
    queryable,
    requestId,
    { forUpdate: true }
  );
  const next = nextPhysicalStatus(request.transfer_status, rollup.complete);
  if (next.status !== (request.transfer_status || 'awaiting_source')) {
    await queryable.query(
      `UPDATE requests
       SET transfer_status = $2,
           status = CASE
             WHEN status IN ('cancelled', 'fulfilled') THEN status
             ELSE 'half_fulfilled'
           END
       WHERE id = $1`,
      [requestId, next.status]
    );
    if (next.status === 'ready_for_rep') {
      await recordRequestMovement(queryable, requestId, {
        movementType: 'ready_for_rep',
        fromBranch: request.fulfillment_branch,
        toBranch: request.destination_branch,
        actorId,
        details: { source: 'physical_receipt_rollup' },
      });
    }
  }
  return {
    request: { ...request, transfer_status: next.status },
    rollup,
    mismatch: next.mismatch,
  };
}

async function existingReceiptsForDuplicate(queryable, {
  receivingBranch,
  requestStoneId,
  barcode,
  excludeReceiptId = null,
}) {
  const params = [receivingBranch];
  const conditions = ['receiving_branch = $1'];
  if (requestStoneId) {
    params.push(requestStoneId);
    conditions.push(`request_stone_id = $${params.length}`);
  } else {
    params.push(barcode);
    conditions.push(`request_stone_id IS NULL AND barcode = $${params.length}`);
  }
  if (excludeReceiptId) {
    params.push(excludeReceiptId);
    conditions.push(`id <> $${params.length}`);
  }
  const { rows } = await queryable.query(
    `SELECT stone_received, cert_received
     FROM shipment_receipts
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows;
}

function duplicateError(components) {
  const label = components.join(' and ');
  return routeError(
    `${label.charAt(0).toUpperCase()}${label.slice(1)} was already received. Confirm the duplicate override only for a genuine additional package.`,
    409,
    { duplicateComponents: components }
  );
}

async function fetchHistory(queryable, {
  branch,
  date,
  search = '',
  sourceBranch = '',
  status = '',
}) {
  const params = [branch, date];
  const conditions = [
    'sh.receiving_branch = $1',
    'sh.received_on = $2::date',
  ];
  const normalizedSearch = String(search || '').trim().slice(0, 100);
  if (normalizedSearch) {
    params.push(`%${normalizedSearch.toLowerCase()}%`);
    conditions.push(
      `(LOWER(sh.barcode) LIKE $${params.length}
        OR LOWER(COALESCE(sr.name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(sh.request_id::text, '')) LIKE $${params.length})`
    );
  }
  if (sourceBranch) {
    const normalizedSource = String(sourceBranch).toUpperCase();
    if (!VALID_BRANCHES.has(normalizedSource)) throw routeError('Invalid source branch');
    params.push(normalizedSource);
    conditions.push(`sh.source_branch = $${params.length}`);
  }

  const { rows } = await queryable.query(
    `SELECT sh.id, sh.receiving_branch, sh.source_branch, sh.request_id,
            sh.request_stone_id, sh.barcode, sh.stone_received,
            sh.cert_received, sh.match_state, sh.received_on, sh.received_at,
            sh.received_by, sh.duplicate_override, sh.workflow_mismatch,
            sh.note, sh.corrected_at, sh.corrected_by,
            u.email AS received_by_email,
            cu.email AS corrected_by_email,
            r.transfer_status, r.request_scope,
            sr.id AS rep_id, sr.name AS rep_name
     FROM shipment_receipts sh
     JOIN users u ON u.id = sh.received_by
     LEFT JOIN users cu ON cu.id = sh.corrected_by
     LEFT JOIN requests r ON r.id = sh.request_id
     LEFT JOIN sales_reps sr ON sr.id = r.sales_rep_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sh.received_at DESC, sh.id DESC
     LIMIT 2500`,
    params
  );

  const requestIds = [...new Set(
    rows
      .map((row) => row.request_id)
      .filter((requestId) => requestId != null)
      .map(Number)
  )];
  const rollups = new Map();
  for (const requestId of requestIds) {
    const { rollup } = await loadRequestAndRollup(queryable, requestId);
    rollups.set(requestId, rollup);
  }

  const mapped = rows.map((row) => {
    const requestId = row.request_id == null ? null : Number(row.request_id);
    const rollup = requestId == null ? null : rollups.get(requestId);
    const requestComplete = Boolean(rollup?.complete);
    const receiptStatus = receiptStatusLabel({
      matchState: row.match_state,
      requestComplete,
      transferStatus: row.transfer_status,
    });
    return {
      id: Number(row.id),
      receivingBranch: row.receiving_branch,
      sourceBranch: row.source_branch,
      requestId,
      requestStoneId: row.request_stone_id == null ? null : Number(row.request_stone_id),
      barcode: row.barcode,
      stoneReceived: row.stone_received,
      certReceived: row.cert_received,
      matchState: row.match_state,
      receivedOn: row.received_on,
      receivedAt: row.received_at,
      receivedBy: {
        id: Number(row.received_by),
        email: row.received_by_email,
      },
      duplicateOverride: row.duplicate_override,
      workflowMismatch: row.workflow_mismatch,
      note: row.note,
      correctedAt: row.corrected_at,
      correctedByEmail: row.corrected_by_email,
      transferStatus: row.transfer_status,
      requestScope: row.request_scope,
      requestComplete,
      handedOff: row.transfer_status === 'handed_to_rep',
      canHandoff: row.match_state === 'matched'
        && requestComplete
        && row.transfer_status !== 'handed_to_rep',
      canCorrect: row.match_state !== 'matched'
        || row.transfer_status !== 'handed_to_rep',
      status: receiptStatus,
      rep: row.rep_id == null
        ? null
        : { id: Number(row.rep_id), name: row.rep_name },
    };
  });
  const allowedStatuses = new Set([
    'Needs review',
    'Partial arrival',
    'Ready for rep',
    'Handed over',
  ]);
  if (status && !allowedStatuses.has(status)) throw routeError('Invalid receipt status');
  return status ? mapped.filter((row) => row.status === status) : mapped;
}

function sendRouteError(res, next, error) {
  if (!error.status) return next(error);
  return res.status(error.status).json({
    error: error.message,
    ...(error.duplicateComponents
      ? { duplicateComponents: error.duplicateComponents }
      : {}),
  });
}

router.get('/lookup', async (req, res, next) => {
  try {
    const receivingBranch = await inventoryBranch(pool, req.user.id);
    if (!receivingBranch) throw routeError('Your inventory account is missing a branch', 403);
    const barcode = normalizeBarcode(String(req.query.barcode || ''));
    const [candidates, previousReceipts] = await Promise.all([
      findCandidates(pool, { receivingBranch, barcode }),
      findPreviousReceipts(pool, receivingBranch, barcode),
    ]);
    const elsewhere = candidates.length === 0
      ? await findElsewhereMatch(pool, { receivingBranch, barcode })
      : null;
    res.json({
      barcode,
      receivingBranch,
      candidates,
      previousReceipts,
      elsewhere,
    });
  } catch (error) {
    sendRouteError(res, next, error);
  }
});

router.get('/export', async (req, res, next) => {
  try {
    const branch = await inventoryBranch(pool, req.user.id);
    if (!branch) throw routeError('Your inventory account is missing a branch', 403);
    const date = parseReceiptDate(req.query.date, branch);
    const rows = await fetchHistory(pool, {
      branch,
      date,
      search: req.query.search,
      sourceBranch: req.query.sourceBranch,
      status: req.query.status,
    });
    const workbook = buildReceiptWorkbook(rows.map((row) => ({
      barcode: row.barcode,
      stoneReceived: row.stoneReceived,
      certReceived: row.certReceived,
      sourceBranch: row.sourceBranch,
      receivedAt: row.receivedAt,
      requestId: row.requestId,
      repName: row.rep?.name || '',
      status: row.status,
      receivedByEmail: row.receivedBy.email,
    })), { branch, date });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${receiptExportFilename(branch, date)}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (error) {
    sendRouteError(res, next, error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const branch = await inventoryBranch(pool, req.user.id);
    if (!branch) throw routeError('Your inventory account is missing a branch', 403);
    const date = parseReceiptDate(req.query.date, branch);
    const rows = await fetchHistory(pool, {
      branch,
      date,
      search: req.query.search,
      sourceBranch: req.query.sourceBranch,
      status: req.query.status,
    });
    res.json({ branch, date, rows });
  } catch (error) {
    sendRouteError(res, next, error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const receivingBranch = await inventoryBranch(pool, req.user.id);
    if (!receivingBranch) throw routeError('Your inventory account is missing a branch', 403);
    const input = normalizeReceiptInput(req.body);
    const now = new Date();
    const result = await withTransaction(pool, async (client) => {
      let candidate = null;
      if (input.requestStoneId) {
        const candidates = await findCandidates(client, {
          receivingBranch,
          barcode: input.barcode,
          forUpdate: true,
        });
        candidate = selectReceiptCandidate(
          candidates,
          input.requestStoneId,
          receivingBranch,
          input.barcode
        );
      }
      const sourceBranch = candidate?.sourceBranch || input.sourceBranch;
      if (!sourceBranch) throw routeError('A source branch is required');
      if (sourceBranch === receivingBranch) {
        throw routeError('Receive Shipments is only for arrivals from another branch');
      }

      const existing = await existingReceiptsForDuplicate(client, {
        receivingBranch,
        requestStoneId: candidate?.requestStoneId || null,
        barcode: input.barcode,
      });
      const duplicates = duplicateComponents(existing, input);
      if (duplicates.length && !input.duplicateOverride) throw duplicateError(duplicates);

      const { rows } = await client.query(
        `INSERT INTO shipment_receipts
           (receiving_branch, source_branch, request_id, request_stone_id,
            barcode, stone_received, cert_received, match_state, received_on,
            received_at, received_by, duplicate_override, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13)
         RETURNING id, received_on, received_at`,
        [
          receivingBranch,
          sourceBranch,
          candidate?.requestId || null,
          candidate?.requestStoneId || null,
          input.barcode,
          input.stoneReceived,
          input.certReceived,
          candidate ? 'matched' : 'unmatched',
          branchLocalDate(receivingBranch, now),
          now,
          req.user.id,
          input.duplicateOverride,
          input.note,
        ]
      );
      const receipt = rows[0];
      let progress = null;
      if (candidate) {
        await recordStoneMovement(client, {
          requestId: candidate.requestId,
          requestStoneId: candidate.requestStoneId,
          movementType: 'physical_receipt_recorded',
          fromBranch: sourceBranch,
          toBranch: receivingBranch,
          actorId: req.user.id,
          details: {
            receiptId: Number(receipt.id),
            stoneReceived: input.stoneReceived,
            certReceived: input.certReceived,
          },
        });
        progress = await recomputePhysicalProgress(client, {
          requestId: candidate.requestId,
          actorId: req.user.id,
        });
        if (progress.mismatch) {
          await client.query(
            'UPDATE shipment_receipts SET workflow_mismatch = $2::jsonb WHERE id = $1',
            [receipt.id, JSON.stringify(progress.mismatch)]
          );
        }
      }
      await writeReceiptAudit(client, {
        actorId: req.user.id,
        action: 'receipt.created',
        targetType: 'shipment_receipt',
        targetId: receipt.id,
        ip: req.ip,
        details: {
          barcode: input.barcode,
          sourceBranch,
          receivingBranch,
          requestId: candidate?.requestId || null,
          stoneReceived: input.stoneReceived,
          certReceived: input.certReceived,
          duplicateOverride: input.duplicateOverride,
        },
      });
      return {
        id: Number(receipt.id),
        barcode: input.barcode,
        stoneReceived: input.stoneReceived,
        certReceived: input.certReceived,
        sourceBranch,
        receivingBranch,
        requestId: candidate?.requestId || null,
        requestStoneId: candidate?.requestStoneId || null,
        matchState: candidate ? 'matched' : 'unmatched',
        receivedOn: receipt.received_on,
        receivedAt: receipt.received_at,
        requestComplete: Boolean(progress?.rollup.complete),
        transferStatus: progress?.request.transfer_status || null,
        workflowMismatch: progress?.mismatch || null,
        rep: candidate?.rep || null,
      };
    });

    broadcast(receivingBranch, 'receipt:updated', {
      receiptId: result.id,
      requestId: result.requestId,
    });
    if (result.sourceBranch !== receivingBranch) {
      broadcast(result.sourceBranch, 'request:updated', {
        requestId: result.requestId,
      });
    }
    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, next, error);
  }
});

router.patch('/:id/link', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const requestStoneId = parseId(req.body?.requestStoneId);
    if (!id || !requestStoneId) {
      throw routeError('Valid receipt and request stone are required');
    }
    const receivingBranch = await inventoryBranch(pool, req.user.id);
    if (!receivingBranch) throw routeError('Your inventory account is missing a branch', 403);
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM shipment_receipts
         WHERE id = $1 AND receiving_branch = $2
         FOR UPDATE`,
        [id, receivingBranch]
      );
      const receipt = rows[0];
      if (!receipt) throw routeError('Receipt not found', 404);
      if (receipt.match_state !== 'unmatched') throw routeError('Receipt is already linked', 409);

      const candidates = await findCandidates(client, {
        receivingBranch,
        barcode: receipt.barcode,
        forUpdate: true,
      });
      const candidate = selectReceiptCandidate(
        candidates,
        requestStoneId,
        receivingBranch,
        receipt.barcode
      );
      const existing = await existingReceiptsForDuplicate(client, {
        receivingBranch,
        requestStoneId: candidate.requestStoneId,
        barcode: receipt.barcode,
      });
      const duplicates = duplicateComponents(existing, {
        stoneReceived: receipt.stone_received,
        certReceived: receipt.cert_received,
      });
      const duplicateOverride = req.body?.duplicateOverride === true;
      if (duplicates.length && !duplicateOverride) throw duplicateError(duplicates);

      await client.query(
        `UPDATE shipment_receipts
         SET request_id = $2, request_stone_id = $3, source_branch = $4,
             match_state = 'matched',
             duplicate_override = duplicate_override OR $5,
             corrected_at = now(), corrected_by = $6
         WHERE id = $1`,
        [
          id,
          candidate.requestId,
          candidate.requestStoneId,
          candidate.sourceBranch,
          duplicateOverride,
          req.user.id,
        ]
      );
      await recordStoneMovement(client, {
        requestId: candidate.requestId,
        requestStoneId: candidate.requestStoneId,
        movementType: 'physical_receipt_linked',
        fromBranch: candidate.sourceBranch,
        toBranch: receivingBranch,
        actorId: req.user.id,
        details: { receiptId: id },
      });
      const progress = await recomputePhysicalProgress(client, {
        requestId: candidate.requestId,
        actorId: req.user.id,
      });
      if (progress.mismatch) {
        await client.query(
          'UPDATE shipment_receipts SET workflow_mismatch = $2::jsonb WHERE id = $1',
          [id, JSON.stringify(progress.mismatch)]
        );
      }
      await writeReceiptAudit(client, {
        actorId: req.user.id,
        action: 'receipt.linked',
        targetType: 'shipment_receipt',
        targetId: id,
        ip: req.ip,
        details: {
          requestId: candidate.requestId,
          requestStoneId: candidate.requestStoneId,
          duplicateOverride,
        },
      });
      return {
        id,
        requestId: candidate.requestId,
        requestStoneId: candidate.requestStoneId,
        requestComplete: progress.rollup.complete,
        transferStatus: progress.request.transfer_status,
        sourceBranch: candidate.sourceBranch,
      };
    });
    broadcast(receivingBranch, 'receipt:updated', result);
    broadcast(result.sourceBranch, 'request:updated', {
      requestId: result.requestId,
    });
    res.json(result);
  } catch (error) {
    sendRouteError(res, next, error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) throw routeError('Valid receipt is required');
    const receivingBranch = await inventoryBranch(pool, req.user.id);
    if (!receivingBranch) throw routeError('Your inventory account is missing a branch', 403);
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM shipment_receipts
         WHERE id = $1 AND receiving_branch = $2
         FOR UPDATE`,
        [id, receivingBranch]
      );
      const receipt = rows[0];
      if (!receipt) throw routeError('Receipt not found', 404);
      const input = normalizeReceiptInput({
        barcode: receipt.barcode,
        stoneReceived: req.body?.stoneReceived,
        certReceived: req.body?.certReceived,
        sourceBranch: req.body?.sourceBranch ?? receipt.source_branch,
        requestStoneId: receipt.request_stone_id,
        duplicateOverride: req.body?.duplicateOverride,
        note: req.body?.note ?? receipt.note,
      });
      if (receipt.match_state === 'matched' && input.sourceBranch !== receipt.source_branch) {
        throw routeError('A matched receipt source branch comes from its request', 409);
      }
      if (receipt.match_state === 'matched') {
        if (!receipt.request_id) throw routeError('Matched receipt request is missing', 409);
        const { request } = await loadRequestAndRollup(
          client,
          Number(receipt.request_id),
          { forUpdate: true }
        );
        assertReceiptCorrectionAllowed(request);
      }
      const existing = await existingReceiptsForDuplicate(client, {
        receivingBranch,
        requestStoneId: receipt.request_stone_id,
        barcode: receipt.barcode,
        excludeReceiptId: id,
      });
      const duplicates = duplicateComponents(existing, input);
      if (duplicates.length && !input.duplicateOverride) throw duplicateError(duplicates);
      const before = {
        stoneReceived: receipt.stone_received,
        certReceived: receipt.cert_received,
        sourceBranch: receipt.source_branch,
        note: receipt.note,
      };

      await client.query(
        `UPDATE shipment_receipts
         SET stone_received = $2, cert_received = $3, source_branch = $4,
             duplicate_override = $5, note = $6,
             corrected_at = now(), corrected_by = $7
         WHERE id = $1`,
        [
          id,
          input.stoneReceived,
          input.certReceived,
          input.sourceBranch,
          input.duplicateOverride,
          input.note,
          req.user.id,
        ]
      );
      let progress = null;
      if (receipt.request_id && receipt.request_stone_id) {
        await recordStoneMovement(client, {
          requestId: Number(receipt.request_id),
          requestStoneId: Number(receipt.request_stone_id),
          movementType: 'physical_receipt_corrected',
          fromBranch: receipt.source_branch,
          toBranch: receivingBranch,
          actorId: req.user.id,
          details: { receiptId: id, before },
        });
        progress = await recomputePhysicalProgress(client, {
          requestId: Number(receipt.request_id),
          actorId: req.user.id,
        });
      }
      await writeReceiptAudit(client, {
        actorId: req.user.id,
        action: 'receipt.corrected',
        targetType: 'shipment_receipt',
        targetId: id,
        ip: req.ip,
        details: {
          before,
          after: {
            stoneReceived: input.stoneReceived,
            certReceived: input.certReceived,
            sourceBranch: input.sourceBranch,
            note: input.note,
          },
        },
      });
      return {
        id,
        requestId: receipt.request_id == null ? null : Number(receipt.request_id),
        requestComplete: Boolean(progress?.rollup.complete),
        transferStatus: progress?.request.transfer_status || null,
        sourceBranch: input.sourceBranch,
      };
    });
    broadcast(receivingBranch, 'receipt:updated', result);
    if (result.requestId) {
      broadcast(result.sourceBranch, 'request:updated', {
        requestId: result.requestId,
      });
    }
    res.json(result);
  } catch (error) {
    sendRouteError(res, next, error);
  }
});

router.post('/requests/:requestId/handoff', async (req, res, next) => {
  try {
    const requestId = parseId(req.params.requestId);
    if (!requestId) throw routeError('Valid request is required');
    const receivingBranch = await inventoryBranch(pool, req.user.id);
    if (!receivingBranch) throw routeError('Your inventory account is missing a branch', 403);
    const result = await withTransaction(pool, async (client) => {
      const { request, rollup } = await loadRequestAndRollup(
        client,
        requestId,
        { forUpdate: true }
      );
      assertHandoffAllowed({ request, receivingBranch, rollup });
      await client.query(
        `UPDATE requests
         SET transfer_status = 'handed_to_rep', status = 'fulfilled'
         WHERE id = $1`,
        [requestId]
      );
      await recordRequestMovement(client, requestId, {
        movementType: 'handed_to_rep',
        fromBranch: receivingBranch,
        toBranch: receivingBranch,
        actorId: req.user.id,
        details: { source: 'receive_shipments' },
      });
      await writeReceiptAudit(client, {
        actorId: req.user.id,
        action: 'receipt.handed_to_rep',
        targetType: 'request',
        targetId: requestId,
        ip: req.ip,
        details: {
          sourceBranch: request.fulfillment_branch,
          receivingBranch,
          salesRepId: request.sales_rep_id,
        },
      });
      return {
        requestId,
        transferStatus: 'handed_to_rep',
        status: 'fulfilled',
        sourceBranch: request.fulfillment_branch,
        receivingBranch,
      };
    });
    broadcast(receivingBranch, 'receipt:updated', result);
    broadcast(result.sourceBranch, 'request:completed', result);
    res.json(result);
  } catch (error) {
    sendRouteError(res, next, error);
  }
});

module.exports = router;
