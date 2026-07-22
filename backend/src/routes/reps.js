const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Inventory staff also have a branch profile row, so only return accounts
// that are actual active sales reps to the queue filters and sidebar.
router.get('/', requireRole('inventory', 'admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT sr.id, sr.name, sr.branch
       FROM sales_reps sr JOIN users u ON u.sales_rep_id = sr.id
       WHERE u.role = 'sales_rep' AND u.is_active = true
       ORDER BY sr.branch, sr.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, branch } = req.body;
    if (!name || !branch) {
      return res.status(400).json({ error: 'name and branch are required' });
    }
    const { rows } = await pool.query(
      'INSERT INTO sales_reps (name, branch) VALUES ($1, $2) RETURNING id, name, branch',
      [name, branch]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
