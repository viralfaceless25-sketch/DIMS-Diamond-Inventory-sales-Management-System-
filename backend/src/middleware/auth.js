const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured and contain at least 32 characters');
}

// Verifies the Bearer token and attaches req.user =
// { id, email, role, salesRepId, name }. Rejects with 401 if missing/invalid.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.sales_rep_id, u.is_active, u.must_change_password,
              u.token_version, sr.branch
       FROM users u
       LEFT JOIN sales_reps sr ON sr.id = u.sales_rep_id
       WHERE u.id = $1`,
      [payload.id]
    );
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== payload.tokenVersion) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      salesRepId: user.sales_rep_id,
      branch: user.branch || null,
      mustChangePassword: user.must_change_password,
    };
    const passwordChangeAllowed = req.originalUrl === '/api/auth/me' || req.originalUrl === '/api/auth/change-password';
    if (user.must_change_password && !passwordChangeAllowed) {
      return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Restricts a route to specific roles. Use after requireAuth.
// e.g. router.post('/upload', requireAuth, requireRole('inventory'), handler)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this action' });
    }
    next();
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      salesRepId: user.sales_rep_id || null,
      name: user.name || null,
      tokenVersion: user.token_version || 0,
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

module.exports = { requireAuth, requireRole, signToken, JWT_SECRET };
