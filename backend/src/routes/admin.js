const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { passwordError, hashPassword } = require('../utils/passwordSecurity');
const { writeAudit } = require('../services/auditService');
const { withTransaction } = require('../db/withRetry');
const { clearTestData } = require('../services/testDataCleanupService');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const VALID_ROLES = new Set(['sales_rep', 'inventory', 'admin']);
const VALID_BRANCHES = new Set(['NY', 'LA', 'CH']);

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.sales_rep_id AS "salesRepId", u.is_active AS "isActive",
              u.must_change_password AS "mustChangePassword", u.locked_until AS "lockedUntil",
              u.created_at AS "createdAt", sr.name AS "repName", sr.branch
       FROM users u LEFT JOIN sales_reps sr ON sr.id = u.sales_rep_id
       ORDER BY u.email`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    const role = req.body?.role;
    const password = req.body?.password;
    const repName = typeof req.body?.repName === 'string' ? req.body.repName.trim() : '';
    const branch = req.body?.branch;
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Valid email and role are required' });
    }
    const validationError = passwordError(password);
    if (validationError) return res.status(400).json({ error: validationError });
    if ((role === 'sales_rep' || role === 'inventory') && (!repName || !VALID_BRANCHES.has(branch))) {
      return res.status(400).json({ error: 'Staff name and branch are required' });
    }

    // Hash once, outside the transaction — bcrypt is CPU-bound, not DB work,
    // so a transaction retry (CockroachDB serialization conflict) shouldn't
    // redo it.
    const hash = await hashPassword(password);

    let createdUser;
    try {
      createdUser = await withTransaction(pool, async (client) => {
        let salesRepId = null;
        if (role === 'sales_rep' || role === 'inventory') {
          const rep = await client.query(
            'INSERT INTO sales_reps (name, branch) VALUES ($1, $2) RETURNING id',
            [repName, branch]
          );
          salesRepId = rep.rows[0].id;
        }
        const { rows } = await client.query(
          `INSERT INTO users (email, password_hash, role, sales_rep_id, must_change_password)
           VALUES ($1, $2, $3, $4, true)
           RETURNING id, email, role, sales_rep_id AS "salesRepId", is_active AS "isActive", must_change_password AS "mustChangePassword"`,
          [email, hash, role, salesRepId]
        );
        await writeAudit({ actorId: req.user.id, action: 'admin.user_created', targetType: 'user', targetId: rows[0].id, ip: req.ip, details: { email, role, branch: branch || null } }, client);
        return rows[0];
      });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists' });
      throw err;
    }

    res.status(201).json(createdUser);
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isActive = req.body?.isActive;
    if (!Number.isInteger(id) || typeof isActive !== 'boolean') return res.status(400).json({ error: 'Valid user and status are required' });
    if (id === req.user.id && !isActive) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    // Deactivating revokes every live session. Committing that without its
    // audit row would erase who locked an account out and when, so the status
    // change and its audit share one transaction.
    const updated = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET is_active = $2, token_version = token_version + 1,
         failed_login_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1 RETURNING id, is_active AS "isActive"`,
        [id, isActive]
      );
      if (!rows[0]) return null;
      await writeAudit({ actorId: req.user.id, action: isActive ? 'admin.user_activated' : 'admin.user_deactivated', targetType: 'user', targetId: id, ip: req.ip }, client);
      return rows[0];
    });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const password = req.body?.password;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Valid user is required' });
    const validationError = passwordError(password);
    if (validationError) return res.status(400).json({ error: validationError });
    const hash = await hashPassword(password);
    const reset = await withTransaction(pool, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE users SET password_hash = $2, must_change_password = true,
         token_version = token_version + 1, failed_login_attempts = 0,
         locked_until = NULL, updated_at = now() WHERE id = $1`,
        [id, hash]
      );
      if (!rowCount) return false;
      await writeAudit({ actorId: req.user.id, action: 'admin.password_reset', targetType: 'user', targetId: id, ip: req.ip }, client);
      return true;
    });
    if (!reset) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/clear-test-data
// One-time cleanup: clears request workflow and stock data. The service owns
// its schema-derived table policy and writes the audit record on the same
// transaction client as the destructive work.
//
// Query ?dryRun=true (default false) returns row counts without deleting
// anything. A real run additionally requires body { confirm: "DELETE TEST
// DATA" } — an admin role alone is not enough to trigger an irreversible
// delete, since this route could otherwise be hit by mistake.
router.post('/clear-test-data', async (req, res, next) => {
  try {
    const dryRun = req.query.dryRun === 'true';
    if (!dryRun && req.body?.confirm !== 'DELETE TEST DATA') {
      return res.status(400).json({
        error: 'Real deletion requires { "confirm": "DELETE TEST DATA" } in the request body. Use ?dryRun=true first to preview row counts.',
      });
    }

    const counts = await withTransaction(pool, (client) => clearTestData(client, {
      dryRun,
      actorId: req.user.id,
      ip: req.ip,
    }));
    res.json({ dryRun, ...counts });
  } catch (err) {
    next(err);
  }
});

router.get('/audit', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.target_type AS "targetType", a.target_id AS "targetId",
              a.ip_address AS "ipAddress", a.details, a.created_at AS "createdAt", u.email AS "actorEmail"
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC LIMIT 500`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
