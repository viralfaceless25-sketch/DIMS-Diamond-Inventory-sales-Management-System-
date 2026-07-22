const express = require('express');
const pool = require('../db/pool');
const { computeStoneTrackingStatus } = require('../services/statusService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// The audit log is an inventory-staff view of all reps' activity.
router.use(requireAuth, requireRole('inventory'));

// GET /api/tracking?branch=ALL&search=&page=1&pageSize=100
// Flat, one-row-per-requested-stone audit log — the full lifecycle history.
router.get('/', async (req, res, next) => {
  try {
    const { branch, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 100));
    const params = [];
    const conditions = [];

    if (branch && branch !== 'ALL') {
      params.push(branch);
      conditions.push(`r.branch = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const idx = params.length;
      conditions.push(
        `(LOWER(sr.name) LIKE $${idx} OR LOWER(rs.barcode) LIKE $${idx} OR LOWER(COALESCE(ld.certificate_no, jp.cert_no, '')) LIKE $${idx})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalResult = await pool.query(
      `SELECT count(*)::int AS total
       FROM request_stones rs
       JOIN requests r ON r.id = rs.request_id
       JOIN sales_reps sr ON sr.id = r.sales_rep_id
       LEFT JOIN loose_diamonds ld ON ld.barcode = rs.barcode AND rs.item_type = 'loose'
       LEFT JOIN jewelry_pieces jp ON jp.barcode = rs.barcode AND rs.item_type = 'jewelry'
       ${where}`,
      params
    );
    const pageParams = [...params, pageSize, (page - 1) * pageSize];
    const { rows } = await pool.query(
      `SELECT
         rs.id, rs.barcode, rs.stone_found, rs.cert_found, rs.returned,
         rs.stone_found_at, rs.cert_found_at, rs.returned_at,
         r.id AS request_id, r.branch, r.requested_at,
         sr.name AS rep_name,
         COALESCE(ld.certificate_no, jp.cert_no) AS cert_no
       FROM request_stones rs
       JOIN requests r ON r.id = rs.request_id
       JOIN sales_reps sr ON sr.id = r.sales_rep_id
       LEFT JOIN loose_diamonds ld ON ld.barcode = rs.barcode AND rs.item_type = 'loose'
       LEFT JOIN jewelry_pieces jp ON jp.barcode = rs.barcode AND rs.item_type = 'jewelry'
       ${where}
       ORDER BY sr.name ASC, r.requested_at DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );

    const withStatus = rows.map((row) => ({
      ...row,
      trackingStatus: computeStoneTrackingStatus(row),
    }));

    res.json({ rows: withStatus, total: totalResult.rows[0].total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
