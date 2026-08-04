const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

async function recordFailedLogin(userId, db) {
  const { rows } = await db.query(
    `UPDATE users
     SET failed_login_attempts = CASE
           WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
           ELSE failed_login_attempts + 1
         END,
         locked_until = CASE
           WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL
           WHEN failed_login_attempts + 1 = $2 THEN now() + ($3 * interval '1 minute')
           ELSE locked_until
         END,
         updated_at = now()
     WHERE id = $1
       AND is_active = true
       AND (locked_until IS NULL OR locked_until <= now())
     RETURNING id, failed_login_attempts, locked_until`,
    [userId, MAX_FAILED_LOGINS, LOCKOUT_MINUTES]
  );
  return rows[0] || null;
}

async function resetSuccessfulLogin(userId, db) {
  const { rows } = await db.query(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE id = $1
       AND is_active = true
       AND (locked_until IS NULL OR locked_until <= now())
     RETURNING id`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  MAX_FAILED_LOGINS,
  LOCKOUT_MINUTES,
  recordFailedLogin,
  resetSuccessfulLogin,
};
