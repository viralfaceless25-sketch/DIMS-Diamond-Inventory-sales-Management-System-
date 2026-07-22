// Seeds the real Maitri team. Existing email accounts are intentionally left
// untouched, so re-running this never resets a staff member's password.
require('dotenv').config();
const pool = require('./pool');
const { hashPassword, passwordError } = require('../utils/passwordSecurity');
const { withTransaction } = require('./withRetry');

const initialPassword = process.env.STAFF_INITIAL_PASSWORD;
if (!initialPassword) {
  console.error('Set STAFF_INITIAL_PASSWORD to a strong temporary password before seeding staff.');
  process.exit(1);
}

const staff = [
  ['sales@maitri.nyc', 'sales_rep', 'Surbhi', 'NY'],
  ['sales1@maitri.nyc', 'sales_rep', 'Karan', 'NY'],
  ['sales2@maitri.nyc', 'sales_rep', 'Parth', 'NY'],
  ['sales3@maitri.nyc', 'sales_rep', 'Dhruvil', 'NY'],
  ['sales4@maitri.nyc', 'sales_rep', 'Harsh', 'NY'],
  ['sales5@maitri.nyc', 'sales_rep', 'Jash', 'NY'],
  ['sales6@maitri.nyc', 'sales_rep', 'Keyush', 'NY'],
  ['stocstockny@maitri.nyc', 'inventory', 'Inventory NY', 'NY'],
  ['sales11@maitri.nyc', 'sales_rep', 'Romil', 'CH'],
  ['sales12@maitri.nyc', 'sales_rep', 'Ajay', 'CH'],
  ['fadi@maitri.nyc', 'sales_rep', 'Fadi', 'LA'],
  ['parthik@maitri.nyc', 'sales_rep', 'Parthik', 'LA'],
  ['sales20@maitri.nyc', 'sales_rep', 'Parth (LA)', 'LA'],
  ['sales21@maitri.nyc', 'sales_rep', 'Sahil', 'CH'],
];
if (process.env.STAFF_CH_INVENTORY_EMAIL) staff.push([process.env.STAFF_CH_INVENTORY_EMAIL, 'inventory', 'Meet', 'CH']);
if (process.env.STAFF_LA_INVENTORY_EMAIL) staff.push([process.env.STAFF_LA_INVENTORY_EMAIL, 'inventory', 'Chintan', 'LA']);

async function main() {
  const error = passwordError(initialPassword);
  if (error) throw new Error(`STAFF_INITIAL_PASSWORD is not acceptable: ${error}`);
  const hash = await hashPassword(initialPassword);
  const created = [];
  const skipped = [];
  for (const [rawEmail, role, name, branch] of staff) {
    const email = rawEmail.toLowerCase().trim();
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
  if (!process.env.STAFF_CH_INVENTORY_EMAIL || !process.env.STAFF_LA_INVENTORY_EMAIL) {
    console.log('Chicago and Los Angeles inventory accounts were not created because their email addresses were not supplied.');
  }
}
main().catch((err) => { console.error('Staff seeding failed:', err.message); process.exitCode = 1; }).finally(() => pool.end());
