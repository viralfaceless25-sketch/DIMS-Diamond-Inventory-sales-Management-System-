const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseEnumParam, parseText } = require('../utils/requestParams');

const VALID_BRANCHES = ['NY', 'LA', 'CH'];

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
    // `[]` and `{}` are truthy, so a bare `if (!name)` check let them through
    // to the INSERT. `branch` is a foreign key onto `branches`, so an unknown
    // value used to surface as a 500 rather than a message the admin can act
    // on.
    const name = parseText(req.body?.name, { maxLength: 200 });
    const branch = parseEnumParam(req.body?.branch, VALID_BRANCHES);
    if (!name) {
      return res.status(400).json({ error: 'A staff name of 1-200 characters is required' });
    }
    if (!branch) {
      return res.status(400).json({ error: `Choose a branch: ${VALID_BRANCHES.join(', ')}` });
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
