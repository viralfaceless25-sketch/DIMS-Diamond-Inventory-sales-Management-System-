require('dotenv').config();
const pool = require('./pool');
const { passwordError, hashPassword } = require('../utils/passwordSecurity');

async function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const validationError = passwordError(password);
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || validationError) {
    throw new Error(`ADMIN_EMAIL and a strong ADMIN_PASSWORD are required. ${validationError || ''}`.trim());
  }
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, must_change_password)
     VALUES ($1, $2, 'admin', true)
     ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash,
       is_active = true, must_change_password = true, token_version = users.token_version + 1,
       failed_login_attempts = 0, locked_until = NULL, updated_at = now()`,
    [email, hash]
  );
  console.log(`Admin account ready: ${email}`);
  await pool.end();
}

seedAdmin().catch((err) => {
  console.error('Admin setup failed:', err.message);
  process.exit(1);
});
