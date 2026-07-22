// Seeds demo login accounts so you can log in immediately after deploying.
// Run with: npm run seed:users
// CHANGE THESE PASSWORDS before any real use.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { passwordError, hashPassword } = require('../utils/passwordSecurity');

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'diamond123';

async function seed() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // Inventory staff account
  await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'inventory')
     ON CONFLICT (email) DO NOTHING`,
    ['inventory@maitri.nyc', hash]
  );

  // Make sure a couple of sales reps exist, then create their login accounts.
  const reps = [
    { name: 'Parthik Davra', branch: 'NY', email: 'parthik@maitri.nyc' },
    { name: 'Keyush', branch: 'NY', email: 'keyush@maitri.nyc' },
    { name: 'Sales 0', branch: 'NY', email: 'sales0@maitri.nyc' },
    { name: 'Sales 1', branch: 'NY', email: 'sales1@maitri.nyc' },
    { name: 'Sales 2', branch: 'NY', email: 'sales2@maitri.nyc' },
    { name: 'Sales 3', branch: 'LA', email: 'sales3@maitri.nyc' },
    { name: 'Sales 4', branch: 'LA', email: 'sales4@maitri.nyc' },
    { name: 'Sales 5', branch: 'CH', email: 'sales5@maitri.nyc' },
    { name: 'Sales 6', branch: 'CH', email: 'sales6@maitri.nyc' },
  ];

  for (const rep of reps) {
    const { rows } = await pool.query(
      `INSERT INTO sales_reps (name, branch)
       SELECT $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM sales_reps WHERE name = $1)
       RETURNING id`,
      [rep.name, rep.branch]
    );
    let repId = rows[0]?.id;
    if (!repId) {
      const existing = await pool.query('SELECT id FROM sales_reps WHERE name = $1', [rep.name]);
      repId = existing.rows[0].id;
    }
    await pool.query(
      `INSERT INTO users (email, password_hash, role, sales_rep_id)
       VALUES ($1, $2, 'sales_rep', $3)
       ON CONFLICT (email) DO NOTHING`,
      [rep.email, hash, repId]
    );
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail || adminPassword) {
    const validationError = passwordError(adminPassword);
    if (!adminEmail || validationError) throw new Error(`ADMIN_EMAIL and a strong ADMIN_PASSWORD are required: ${validationError || 'email missing'}`);
    const adminHash = await hashPassword(adminPassword);
    await pool.query(
      `INSERT INTO users (email, password_hash, role, must_change_password)
       VALUES ($1, $2, 'admin', false)
       ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash,
         is_active = true, must_change_password = false, token_version = users.token_version + 1`,
      [adminEmail.toLowerCase().trim(), adminHash]
    );
    console.log(`  ${adminEmail.toLowerCase().trim()}  (role: admin)`);
  }

  console.log('Seeded demo users:');
  console.log('  inventory@maitri.nyc  (role: inventory)');
  console.log('  parthik@maitri.nyc    (role: sales_rep)');
  console.log('  keyush@maitri.nyc     (role: sales_rep)');
  console.log(`  password for all: ${DEMO_PASSWORD}`);
  await pool.end();
}

seed().catch((err) => {
  console.error('User seeding failed:', err);
  process.exit(1);
});
