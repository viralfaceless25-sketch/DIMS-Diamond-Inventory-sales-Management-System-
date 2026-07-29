// Seeds the real Maitri team. Existing email accounts are intentionally left
// untouched, so re-running this never resets a staff member's password.
require('dotenv').config();
const pool = require('./pool');
const { hashPassword, passwordError } = require('../utils/passwordSecurity');
const { withTransaction } = require('./withRetry');
const { staffAccounts } = require('./staffAccounts');

const initialPassword = process.env.STAFF_INITIAL_PASSWORD;
if (!initialPassword) {
  console.error('Set STAFF_INITIAL_PASSWORD to a strong temporary password before seeding staff.');
  process.exit(1);
}

async function main() {
  const error = passwordError(initialPassword);
  if (error) throw new Error(`STAFF_INITIAL_PASSWORD is not acceptable: ${error}`);
  const hash = await hashPassword(initialPassword);
  const created = [];
  const skipped = [];
  for (const account of staffAccounts()) {
    const { role, name, branch } = account;
    const email = account.email.toLowerCase().trim();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) { skipped.push(email); continue; }
    await withTransaction(pool, async (client) => {
      const profile = await client.query('INSERT INTO sales_reps (name, branch) VALUES ($1, $2) RETURNING id', [name, branch]);
      await client.query(
        `INSERT INTO users (email, password_hash, role, sales_rep_id, must_change_password)
         VALUES ($1, $2, $3, $4, true)`, [email, hash, role, profile.rows[0].id]
      );
    });
    created.push(`${email} (${role}, ${branch})`);
  }
  console.log(`Created ${created.length} account(s); skipped ${skipped.length} existing account(s).`);
  created.forEach((line) => console.log(`  created: ${line}`));
  skipped.forEach((line) => console.log(`  skipped: ${line}`));
}
main().catch((err) => { console.error('Staff seeding failed:', err.message); process.exitCode = 1; }).finally(() => pool.end());
