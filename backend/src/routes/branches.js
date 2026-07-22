const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM branches ORDER BY id');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
