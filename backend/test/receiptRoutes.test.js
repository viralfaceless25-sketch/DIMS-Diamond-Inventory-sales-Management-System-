const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'receipt-route-test-secret-with-more-than-32-characters';
process.env.DATABASE_SSL = 'false';

const pool = require('../src/db/pool');
const router = require('../src/routes/receipts');

function routeHandler(method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  return layer.route.stack.at(-1).handle;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('receipt lookup derives the receiving branch from the authenticated inventory user', async (t) => {
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

  const app = express();
  app.use(express.json());
  app.use('/api/receipts', router);
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

test('terminal matched receipt correction rejects before any receipt, movement, audit, or request write', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });

  pool.query = async (sql) => {
    if (sql.includes('SELECT sr.branch FROM users')) return { rows: [{ branch: 'NY' }] };
    throw new Error(`Unexpected pool SQL: ${sql}`);
  };
  const writes = [];
  const calls = [];
  const client = {
    release() {},
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM shipment_receipts') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: 601,
            receiving_branch: 'NY',
            source_branch: 'CH',
            request_id: 41,
            request_stone_id: 91,
            barcode: '267157-00',
            stone_received: true,
            cert_received: true,
            match_state: 'matched',
            note: null,
          }],
        };
      }
      if (sql.includes('FROM requests r') && sql.includes('WHERE r.id = $1') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: 41,
            status: 'fulfilled',
            transfer_status: 'handed_to_rep',
            delivery_route: 'internal_transfer',
            fulfillment_branch: 'CH',
            destination_branch: 'NY',
            sales_rep_id: 9,
            request_scope: 'stone_and_cert',
          }],
        };
      }
      if (sql.includes('FROM request_stones rs') && sql.includes('WHERE rs.request_id = $1')) {
        return { rows: [{ id: 91, request_scope: 'stone_and_cert' }] };
      }
      if (sql.includes('FROM shipment_receipts') && sql.includes('WHERE request_id = $1')) {
        return { rows: [{ request_stone_id: 91, stone_received: true, cert_received: true }] };
      }
      if (/^(UPDATE|INSERT)/.test(sql.trim())) writes.push(sql);
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    },
  };
  pool.connect = async () => client;
  const res = responseRecorder();

  await routeHandler('patch', '/:id')(
    {
      params: { id: '601' },
      body: { stoneReceived: true, certReceived: false },
      user: { id: 7, role: 'inventory' },
      ip: '127.0.0.1',
    },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'This shipment was already handed to the sales rep');
  assert.equal(calls.some((call) => call.sql.includes('FROM requests r') && call.sql.includes('FOR UPDATE')), true);
  assert.deepEqual(writes, []);
});
