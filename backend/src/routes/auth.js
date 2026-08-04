const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth, signToken } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');
const { passwordError, passwordExceedsBcryptByteLimit, hashPassword } = require('../utils/passwordSecurity');
const { writeAudit } = require('../services/auditService');
const { recordFailedLogin, resetSuccessfulLogin } = require('../services/loginLockoutService');

const router = express.Router();
const GENERIC_LOGIN_ERROR = 'Incorrect email or password';

const loginIpLimit = createRateLimit({ windowMs: 15 * 60_000, max: 40 });
const loginEmailLimit = createRateLimit({
  windowMs: 15 * 60_000,
  max: 12,
  key: (req) => String(req.body?.email || '').toLowerCase().trim() || req.ip,
});

router.post('/login', loginIpLimit, loginEmailLimit, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || email.length > 254) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (passwordExceedsBcryptByteLimit(password)) {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.sales_rep_id, u.is_active,
              u.must_change_password, u.token_version, u.failed_login_attempts, u.locked_until,
              sr.name AS rep_name, sr.branch AS rep_branch
       FROM users u
       LEFT JOIN sales_reps sr ON sr.id = u.sales_rep_id
       WHERE u.email = $1`,
      [email]
    );
    const user = rows[0];
    const locked = user?.locked_until && new Date(user.locked_until) > new Date();
    const ok = user && user.is_active && !locked && await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      if (user && user.is_active && !locked) {
        await recordFailedLogin(user.id, pool);
      }
      await writeAudit({ actorId: user?.id, action: 'auth.login_failed', targetType: 'user', targetId: user?.id, ip: req.ip, details: { email } });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const reset = await resetSuccessfulLogin(user.id, pool);
    if (!reset) {
      await writeAudit({ actorId: user.id, action: 'auth.login_failed', targetType: 'user', targetId: user.id, ip: req.ip, details: { email } });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      sales_rep_id: user.sales_rep_id,
      name: user.rep_name,
      token_version: user.token_version,
    });
    await writeAudit({ actorId: user.id, action: 'auth.login_success', targetType: 'user', targetId: user.id, ip: req.ip });

    res.json({
      token,
      user: {
        id: user.id, email: user.email, role: user.role,
        salesRepId: user.sales_rep_id, name: user.rep_name, branch: user.rep_branch,
        mustChangePassword: user.must_change_password,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.sales_rep_id, u.must_change_password,
              sr.name AS rep_name, sr.branch AS rep_branch
       FROM users u LEFT JOIN sales_reps sr ON sr.id = u.sales_rep_id
       WHERE u.id = $1 AND u.is_active = true`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Invalid or expired session' });
    const u = rows[0];
    res.json({
      id: u.id, email: u.email, role: u.role, salesRepId: u.sales_rep_id,
      name: u.rep_name, branch: u.rep_branch, mustChangePassword: u.must_change_password,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const validationError = passwordError(newPassword);
    if (!currentPassword || validationError) {
      return res.status(400).json({ error: validationError || 'Current password is required' });
    }
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1 AND is_active = true', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hash = await hashPassword(newPassword);
    await pool.query(
      `UPDATE users SET password_hash = $2, must_change_password = false,
       token_version = token_version + 1, updated_at = now() WHERE id = $1`,
      [req.user.id, hash]
    );
    await writeAudit({ actorId: req.user.id, action: 'auth.password_changed', targetType: 'user', targetId: req.user.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout-all', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE users SET token_version = token_version + 1, updated_at = now() WHERE id = $1', [req.user.id]);
    await writeAudit({ actorId: req.user.id, action: 'auth.logout_all', targetType: 'user', targetId: req.user.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
