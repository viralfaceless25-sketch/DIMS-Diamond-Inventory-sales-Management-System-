const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'receipt-route-test-secret-with-more-than-32-characters';
process.env.DATABASE_SSL = 'false';

test('receipt lookup derives the receiving branch from the authenticated inventory user', async (t) => {
  const pool = require('../src/db/pool');
  const originalQuery = pool.query;
  const seen = [];
  pool.query = async (sql, params = []) => {
    seen.push({ sql, params });
    if (sql.includes('token_version') && sql.includes('FROM users')) {
      return {
        rows: [{
          id: 77,
          email: 'stockny@maitri.nyc',
          role: 'inventory',
          sales_rep_id: 501,
          branch: 'NY',
          is_active: true,
          must_change_password: false,
          token_version: 0,
        }],
      };
    }
    if (sql.includes('SELECT sr.branch FROM users')) {
      return { rows: [{ branch: 'NY' }] };
    }
    if (sql.includes('FROM requests r') && sql.includes('JOIN request_stones rs')) {
      return {
        rows: [{
          request_id: 81,
          request_stone_id: 901,
          barcode: '267157-00',
          source_branch: 'CH',
          destination_branch: 'NY',
          request_scope: 'stone_and_cert',
          transfer_status: 'shipped_to_destination',
          request_status: 'half_fulfilled',
          erp_transfer_confirmed: true,
          erp_transfer_received: false,
          rep_id: 22,
          rep_name: 'Parth',
          item_type: 'loose',
        }],
      };
    }
    if (sql.includes('FROM shipment_receipts')) return { rows: [] };
    throw new Error(`Unexpected SQL in route test: ${sql}`);
  };
  t.after(() => { pool.query = originalQuery; });

  const receiptsRouter = require('../src/routes/receipts');
  const app = express();
  app.use(express.json());
  app.use('/api/receipts', receiptsRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const token = jwt.sign({
    id: 77,
    email: 'stockny@maitri.nyc',
    role: 'inventory',
    salesRepId: 501,
    tokenVersion: 0,
  }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const { port } = server.address();
  const response = await fetch(
    `http://127.0.0.1:${port}/api/receipts/lookup?barcode=267157-00&receivingBranch=LA`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.receivingBranch, 'NY');
  assert.equal(body.candidates[0].requestId, 81);
  assert.equal(body.candidates[0].rep.name, 'Parth');
  const candidateQuery = seen.find((call) => call.sql.includes('FROM requests r'));
  assert.deepEqual(candidateQuery.params, ['267157-00', 'NY']);
});
