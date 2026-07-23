const express = require('express');
const pool = require('../db/pool');
const { computeStoneTrackingStatus } = require('../services/statusService');
const { movementLabel } = require('../services/movementService');
const { normalizeStockStatus, stockStatusLabel } = require('../services/stockStatus');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function legacyMovements(row, recordedTypes) {
  const candidates = [
    {
      type: 'requested',
      at: row.requested_at,
      fromBranch: row.fulfillment_branch || row.current_branch || row.branch,
      toBranch: row.delivery_branch || row.branch,
      actorName: row.rep_name,
    },
    {
      type: 'stone_confirmed',
      at: row.stone_found_at,
      fromBranch: row.branch,
      toBranch: row.branch,
      actorName: 'Inventory',
    },
    {
      type: 'certificate_confirmed',
      at: row.cert_found_at,
      fromBranch: row.branch,
      toBranch: row.branch,
      actorName: 'Inventory',
    },
    {
      type: 'returned',
      at: row.returned_at,
      fromBranch: row.branch,
      toBranch: row.branch,
      actorName: 'Inventory',
    },
  ];
  return candidates
    .filter((event) => event.at && !recordedTypes.has(event.type))
    .map((event) => ({
      id: `legacy-${row.id}-${event.type}`,
      movementType: event.type,
      movementLabel: movementLabel(event.type),
      fromBranch: event.fromBranch,
      toBranch: event.toBranch,
      actorName: event.actorName,
      details: {},
      createdAt: event.at,
      historical: true,
    }));
}

// Inventory sees all permitted branches. Sales reps are always restricted to
// their authenticated profile, regardless of query-string values.
router.get('/', async (req, res, next) => {
  try {
    if (!['inventory', 'sales_rep'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Inventory or sales-rep access is required' });
    }

    const { branch, search, movement } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 100));
    const params = [];
    const conditions = [];

    if (req.user.role === 'sales_rep') {
      params.push(req.user.salesRepId);
      conditions.push(`r.sales_rep_id = $${params.length}`);
    } else if (branch && branch !== 'ALL') {
      params.push(branch);
      conditions.push(`(r.branch = $${params.length} OR r.fulfillment_branch = $${params.length} OR r.delivery_branch = $${params.length})`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      const idx = params.length;
      conditions.push(
        `(LOWER(sr.name) LIKE $${idx} OR LOWER(rs.barcode) LIKE $${idx} OR LOWER(COALESCE(ld.certificate_no, jp.cert_no, '')) LIKE $${idx})`
      );
    }
    if (movement) {
      params.push(String(movement));
      conditions.push(`EXISTS (
        SELECT 1 FROM stone_movements movement_filter
        WHERE movement_filter.request_stone_id = rs.id
          AND movement_filter.movement_type = $${params.length}
      )`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseFrom = `
      FROM request_stones rs
      JOIN requests r ON r.id = rs.request_id
      JOIN sales_reps sr ON sr.id = r.sales_rep_id
      LEFT JOIN loose_diamonds ld ON ld.barcode = rs.barcode AND rs.item_type = 'loose'
      LEFT JOIN jewelry_pieces jp ON jp.barcode = rs.barcode AND rs.item_type = 'jewelry'
    `;

    const totalResult = await pool.query(
      `SELECT count(*)::int AS total ${baseFrom} ${where}`,
      params
    );

    const pageParams = [...params, pageSize, (page - 1) * pageSize];
    const { rows } = await pool.query(
      `SELECT
         rs.id, rs.barcode, rs.item_type, rs.stone_found, rs.cert_found, rs.returned,
         rs.stone_found_at, rs.cert_found_at, rs.returned_at,
         r.id AS request_id, r.branch, r.fulfillment_branch, r.delivery_branch,
         r.cross_branch, r.delivery_route, r.transfer_status, r.request_type,
         r.status AS request_status, r.requested_at,
         sr.name AS rep_name,
         COALESCE(ld.branch, jp.branch, r.fulfillment_branch, r.branch) AS current_branch,
         COALESCE(ld.stock_status, jp.stock_status, 'available') AS current_stock_status,
         COALESCE(ld.certificate_no, jp.cert_no) AS cert_no,
         ld.lab, ld.shape, ld.carat, ld.color, ld.clarity,
         jp.category, jp.item, jp.diamond_cts
       ${baseFrom}
       ${where}
       ORDER BY r.requested_at DESC, rs.id DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );

    const stoneIds = rows.map((row) => row.id);
    const movementsByStone = new Map();
    if (stoneIds.length) {
      const { rows: movementRows } = await pool.query(
        `SELECT sm.id, sm.request_stone_id, sm.movement_type, sm.from_branch, sm.to_branch,
                sm.details, sm.created_at,
                COALESCE(actor_sr.name, actor.email, 'System') AS actor_name
         FROM stone_movements sm
         LEFT JOIN users actor ON actor.id = sm.actor_id
         LEFT JOIN sales_reps actor_sr ON actor_sr.id = actor.sales_rep_id
         WHERE sm.request_stone_id = ANY($1)
         ORDER BY sm.created_at DESC, sm.id DESC`,
        [stoneIds]
      );
      for (const movementRow of movementRows) {
        if (!movementsByStone.has(movementRow.request_stone_id)) {
          movementsByStone.set(movementRow.request_stone_id, []);
        }
        movementsByStone.get(movementRow.request_stone_id).push({
          id: movementRow.id,
          movementType: movementRow.movement_type,
          movementLabel: movementLabel(movementRow.movement_type),
          fromBranch: movementRow.from_branch,
          toBranch: movementRow.to_branch,
          actorName: movementRow.actor_name,
          details: movementRow.details || {},
          createdAt: movementRow.created_at,
          historical: false,
        });
      }
    }

    const outRows = rows.map((row) => {
      const movements = movementsByStone.get(row.id) || [];
      const recordedTypes = new Set(movements.map((event) => event.movementType));
      const completeMovements = [...movements, ...legacyMovements(row, recordedTypes)]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const normalizedStatus = normalizeStockStatus(row.current_stock_status);
      return {
        ...row,
        current_stock_status: normalizedStatus,
        currentStockStatusLabel: stockStatusLabel(normalizedStatus),
        trackingStatus: computeStoneTrackingStatus(row),
        movements: completeMovements,
      };
    });

    res.json({
      rows: outRows,
      total: totalResult.rows[0].total,
      page,
      pageSize,
      scope: req.user.role === 'sales_rep' ? 'mine' : 'inventory',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
