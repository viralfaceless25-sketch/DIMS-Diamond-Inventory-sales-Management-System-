const express = require('express');
const pool = require('../db/pool');
const { withTransaction } = require('../db/withRetry');
const {
  buildStockRecheckResolution,
  createOrReuseStockRecheck,
  normalizeStockRecheckInput,
  resolveStockRecheck,
} = require('../services/stockRecheckService');
const { writeAudit } = require('../services/auditService');
const { broadcast } = require('../sockets');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');
const { parseId, parseEnumParam } = require('../utils/requestParams');

const router = express.Router();
router.use(requireAuth);

const RECHECK_STATES = ['pending', 'verified_available', 'verified_unavailable', 'consumed'];

const requestLimit = createRateLimit({
  windowMs: 60 * 60_000,
  max: 60,
  key: (req) => `stock-recheck:${req.user.id}`,
});

async function inventoryBranch(userId) {
  const { rows } = await pool.query(
    `SELECT sr.branch
     FROM users u
     JOIN sales_reps sr ON sr.id = u.sales_rep_id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0]?.branch || null;
}

function presentRecheck(row) {
  return {
    id: row.id,
    salesRepId: row.sales_rep_id,
    salesRepName: row.sales_rep_name || null,
    barcode: row.barcode,
    itemType: row.item_type,
    homeBranch: row.home_branch,
    state: row.state,
    snapshot: {
      active: row.snapshot_active,
      stockStatus: row.snapshot_status,
      lastSeenAt: row.snapshot_last_seen_at,
    },
    verifiedStatus: row.verified_status,
    note: row.note,
    requestedAt: row.requested_at,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    verifierEmail: row.verifier_email || null,
    consumedAt: row.consumed_at,
    consumedRequestId: row.consumed_request_id,
  };
}

router.get('/mine', requireRole('sales_rep'), async (req, res, next) => {
  try {
    if (!req.user.salesRepId) {
      return res.status(400).json({ error: 'Your account is not linked to a sales rep profile' });
    }
    const { rows } = await pool.query(
      `SELECT rr.*, verifier.email AS verifier_email
       FROM stock_recheck_requests rr
       LEFT JOIN users verifier ON verifier.id = rr.verified_by
       WHERE rr.sales_rep_id = $1
       ORDER BY rr.requested_at DESC, rr.id DESC
       LIMIT 200`,
      [req.user.salesRepId]
    );
    res.json(rows.map(presentRecheck));
  } catch (error) {
    next(error);
  }
});

router.get('/queue', requireRole('inventory'), async (req, res, next) => {
  try {
    const state = parseEnumParam(req.query.state, RECHECK_STATES, 'pending');
    if (!state) {
      return res.status(400).json({
        error: `Choose one of: ${RECHECK_STATES.join(', ')}`,
      });
    }
    const branch = await inventoryBranch(req.user.id);
    if (!branch) {
      return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    }
    const { rows } = await pool.query(
      `SELECT rr.*, sr.name AS sales_rep_name, verifier.email AS verifier_email
       FROM stock_recheck_requests rr
       JOIN sales_reps sr ON sr.id = rr.sales_rep_id
       LEFT JOIN users verifier ON verifier.id = rr.verified_by
       WHERE rr.home_branch = $1 AND rr.state = $2
       ORDER BY rr.requested_at ASC, rr.id ASC
       LIMIT 200`,
      [branch, state]
    );
    res.json({ branch, rows: rows.map(presentRecheck) });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireRole('sales_rep'), requestLimit, async (req, res, next) => {
  try {
    if (!req.user.salesRepId) {
      return res.status(400).json({ error: 'Your account is not linked to a sales rep profile' });
    }
    const input = normalizeStockRecheckInput(req.body);
    const result = await withTransaction(pool, async (client) => {
      const created = await createOrReuseStockRecheck(client, {
        salesRepId: req.user.salesRepId,
        ...input,
      });
      await writeAudit({
        actorId: req.user.id,
        action: created.reused
          ? 'stock_recheck.reused'
          : 'stock_recheck.requested',
        targetType: 'stock_recheck',
        targetId: created.recheck.id,
        ip: req.ip,
        details: {
          barcode: input.barcode,
          itemType: input.itemType,
          homeBranch: created.recheck.home_branch,
        },
      }, client);
      return created;
    });

    broadcast(result.recheck.home_branch, 'stock:recheck_requested', {
      recheckId: result.recheck.id,
      barcode: input.barcode,
      itemType: input.itemType,
    });
    res.status(result.reused ? 200 : 201).json({
      ...presentRecheck(result.recheck),
      reused: result.reused,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.patch('/:id', requireRole('inventory'), async (req, res, next) => {
  try {
    const recheckId = parseId(req.params.id);
    if (!recheckId) {
      return res.status(400).json({ error: 'Valid stock recheck is required' });
    }
    const branch = await inventoryBranch(req.user.id);
    if (!branch) {
      return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    }
    const resolution = buildStockRecheckResolution(req.body);
    const result = await withTransaction(pool, async (client) => {
      const resolved = await resolveStockRecheck(client, {
        recheckId,
        actorRole: req.user.role,
        actorBranch: branch,
        actorId: req.user.id,
        resolution,
      });
      await writeAudit({
        actorId: req.user.id,
        action: resolved.state === 'verified_available'
          ? 'stock_recheck.verified_available'
          : 'stock_recheck.verified_unavailable',
        targetType: 'stock_recheck',
        targetId: resolved.id,
        ip: req.ip,
        details: {
          barcode: resolved.barcode,
          itemType: resolved.item_type,
          homeBranch: resolved.home_branch,
          verifiedStatus: resolved.verified_status,
        },
      }, client);
      return resolved;
    });

    const { rows: repRows } = await pool.query(
      'SELECT branch FROM sales_reps WHERE id = $1',
      [result.sales_rep_id]
    );
    broadcast(branch, 'stock:recheck_resolved', {
      recheckId: result.id,
      state: result.state,
    });
    if (repRows[0]?.branch && repRows[0].branch !== branch) {
      broadcast(repRows[0].branch, 'stock:recheck_resolved', {
        recheckId: result.id,
        state: result.state,
      });
    }
    res.json(presentRecheck(result));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

module.exports = router;
