const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET ||= 'test-only-jwt-secret-with-at-least-32-characters';
const pool = require('../src/db/pool');
const router = require('../src/routes/requests');

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

test('inventory request details reject a branch outside the request route', async (t) => {
  const originalQuery = pool.query;
  t.after(() => { pool.query = originalQuery; });
  let queryCount = 0;
  pool.query = async () => {
    queryCount += 1;
    return { rows: [{
      id: 41,
      branch: 'LA',
      fulfillment_branch: 'NY',
      delivery_branch: 'LA',
      rep_id: 3,
    }] };
  };
  const res = responseRecorder();

  await routeHandler('get', '/:id')(
    { params: { id: '41' }, user: { role: 'inventory', branch: 'CH' } },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /do not have access/);
  assert.equal(queryCount, 1, 'authorization must run before stone detail queries');
});

test('row mutation rejects a field excluded by the stored request scope', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  pool.query = async () => ({ rows: [{ branch: 'NY' }] });
  const client = {
    release() {},
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM requests WHERE id = $1 FOR UPDATE')) {
        return { rows: [{
          branch: 'NY', fulfillment_branch: 'NY', delivery_branch: 'NY',
          cross_branch: false, request_scope: 'stone_only', status: 'awaiting',
          resolution_confirmed: false,
        }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  pool.connect = async () => client;
  const res = responseRecorder();

  await routeHandler('patch', '/:id/stones/:stoneId')(
    {
      params: { id: '41', stoneId: '9' },
      body: { field: 'cert_found', value: true },
      user: { id: 7, role: 'inventory', branch: 'NY' },
    },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /does not request certificates/);
});

test('row mutation rejects edits after resolution confirmation', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  pool.query = async () => ({ rows: [{ branch: 'NY' }] });
  const client = {
    release() {},
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM requests WHERE id = $1 FOR UPDATE')) {
        return { rows: [{
          branch: 'NY', fulfillment_branch: 'NY', delivery_branch: 'NY',
          cross_branch: false, request_scope: 'stone_and_cert', status: 'half_fulfilled',
          resolution_confirmed: true,
        }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  pool.connect = async () => client;
  const res = responseRecorder();

  await routeHandler('patch', '/:id/stones/:stoneId')(
    {
      params: { id: '41', stoneId: '9' },
      body: { field: 'not_found', value: true },
      user: { id: 7, role: 'inventory', branch: 'NY' },
    },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /already confirmed/);
});

test('check-all returned reopen rejects a competing active holder after locking stock', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  pool.query = async () => ({ rows: [{ branch: 'LA' }] });
  const calls = [];
  const client = {
    release() {},
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM requests WHERE id = $1 FOR UPDATE')) {
        return { rows: [{
          branch: 'LA', fulfillment_branch: 'LA', delivery_branch: 'LA',
          cross_branch: false, delivery_route: null, transfer_status: null,
          request_scope: 'stone_and_cert', status: 'fulfilled', resolution_confirmed: false,
        }] };
      }
      if (sql === 'SELECT request_scope FROM requests WHERE id = $1') {
        return { rows: [{ request_scope: 'stone_and_cert' }] };
      }
      if (sql.includes('FROM request_stones WHERE request_id = $1')) {
        return { rows: [{
          id: 9, barcode: 'LA-100', item_type: 'loose', returned: true,
          stone_found: true, cert_found: true, not_found: false,
          stone_found_at: null, cert_found_at: null, not_found_at: null, not_found_by: null,
        }] };
      }
      if (sql.includes('FROM loose_diamonds')) {
        return { rows: [{
          barcode: 'LA-100', branch: 'LA', stock_status: 'available',
          snapshot_active: true, item_type: 'loose',
        }] };
      }
      if (sql.includes('FROM request_stones rs')) {
        return { rows: [{
          barcode: 'LA-100', request_id: 99, sales_rep_id: 8,
          rep_name: 'Other Rep', supply_branch: 'LA',
        }] };
      }
      if (sql.includes('SET returned = $1')) return { rows: [] };
      if (sql.includes('JOIN requests r')) {
        return { rows: [{
          id: 9, request_id: 41, barcode: 'LA-100', item_type: 'loose',
          stone_found: true, cert_found: true, not_found: false, returned: false,
        }] };
      }
      if (sql.includes('SET status = $1')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  pool.connect = async () => client;
  const res = responseRecorder();

  await routeHandler('patch', '/:id/check-all')(
    {
      params: { id: '41' }, body: { field: 'returned', value: false },
      user: { id: 7, role: 'inventory', branch: 'LA' },
    },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'Request blocked: LA-100 is already requested by Other Rep');
  const stockLock = calls.findIndex((call) => call.sql.includes('FROM loose_diamonds'));
  const holderCheck = calls.findIndex((call) => call.sql.includes('FROM request_stones rs'));
  assert.ok(stockLock >= 0 && stockLock < holderCheck);
});

test('row returned reopen rejects a competing active holder after locking stock', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  pool.query = async () => ({ rows: [{ branch: 'LA' }] });
  const calls = [];
  const client = {
    release() {},
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM requests WHERE id = $1 FOR UPDATE')) {
        return { rows: [{
          branch: 'LA', fulfillment_branch: 'LA', delivery_branch: 'LA',
          cross_branch: false, delivery_route: null, transfer_status: null,
          request_scope: 'stone_and_cert', status: 'fulfilled', resolution_confirmed: false,
        }] };
      }
      if (sql.includes('FROM request_stones\n             WHERE id = $1')) {
        return { rows: [{ id: 9, barcode: 'LA-100', item_type: 'loose', returned: true }] };
      }
      if (sql.includes('FROM loose_diamonds')) {
        return { rows: [{
          barcode: 'LA-100', branch: 'LA', stock_status: 'available',
          snapshot_active: true, item_type: 'loose',
        }] };
      }
      if (sql.includes('FROM request_stones rs')) {
        return { rows: [{
          barcode: 'LA-100', request_id: 99, sales_rep_id: 8,
          rep_name: 'Other Rep', supply_branch: 'LA',
        }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  pool.connect = async () => client;
  const res = responseRecorder();

  await routeHandler('patch', '/:id/stones/:stoneId')(
    {
      params: { id: '41', stoneId: '9' }, body: { field: 'returned', value: false },
      user: { id: 7, role: 'inventory', branch: 'LA' },
    },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'Request blocked: LA-100 is already requested by Other Rep');
  const stockLock = calls.findIndex((call) => call.sql.includes('FROM loose_diamonds'));
  const holderCheck = calls.findIndex((call) => call.sql.includes('FROM request_stones rs'));
  assert.ok(stockLock >= 0 && stockLock < holderCheck);
});

test('direct confirmation records an implied first view before confirming', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  pool.query = async () => ({ rows: [{ branch: 'NY' }] });
  const sqlCalls = [];
  const client = {
    release() {},
    async query(sql) {
      sqlCalls.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('FROM requests WHERE id = $1 FOR UPDATE')) {
        return { rows: [{
          branch: 'NY', fulfillment_branch: 'NY', cross_branch: false,
          delivery_route: null, transfer_status: null, request_scope: 'stone_only',
          status: 'awaiting', resolution_confirmed: false,
          inventory_viewed_at: null, inventory_viewed_by: null,
        }] };
      }
      if (sql.includes('FROM request_stones rs') && sql.includes('JOIN requests r')) {
        return { rows: [{
          id: 9, request_id: 41, barcode: 'D1', item_type: 'loose',
          stone_found: true, cert_found: false, not_found: false, returned: false,
        }] };
      }
      if (sql.includes('SET inventory_viewed_at')) {
        return { rows: [{ inventory_viewed_at: '2026-08-04T12:00:00Z', inventory_viewed_by: 7 }] };
      }
      if (sql.includes('COALESCE(r.requested_by')) return { rows: [{ user_id: 22 }] };
      if (sql.includes('SET status = $1, resolution_confirmed = true')) {
        return { rows: [{ resolution_confirmed_at: '2026-08-04T12:00:01Z', resolution_confirmed_by: 7 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  pool.connect = async () => client;
  const res = responseRecorder();

  await routeHandler('patch', '/:id/confirm-resolution')(
    { params: { id: '41' }, user: { id: 7, role: 'inventory', branch: 'NY' } },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 200);
  const viewIndex = sqlCalls.findIndex((sql) => sql.includes('SET inventory_viewed_at'));
  const confirmIndex = sqlCalls.findIndex((sql) => sql.includes('resolution_confirmed = true'));
  assert.ok(viewIndex >= 0 && viewIndex < confirmIndex);
});

test('repeat confirmation preserves the stored workflow status without rewriting it', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  pool.query = async () => ({ rows: [{ branch: 'NY' }] });
  const sqlCalls = [];
  const client = {
    release() {},
    async query(sql) {
      sqlCalls.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('FROM requests WHERE id = $1 FOR UPDATE')) {
        return { rows: [{
          branch: 'NY', fulfillment_branch: 'NY', cross_branch: false,
          delivery_route: 'customer_ship', transfer_status: 'packed', request_scope: 'stone_only',
          status: 'packed', resolution_confirmed: true,
          resolution_confirmed_at: '2026-08-04T12:00:01Z', resolution_confirmed_by: 7,
          inventory_viewed_at: '2026-08-04T12:00:00Z', inventory_viewed_by: 7,
        }] };
      }
      if (sql.includes('FROM request_stones rs') && sql.includes('JOIN requests r')) {
        return { rows: [{
          id: 9, request_id: 41, barcode: 'D1', item_type: 'loose',
          stone_found: true, cert_found: false, not_found: false, returned: false,
        }] };
      }
      if (sql.includes('SET inventory_viewed_at')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  pool.connect = async () => client;
  const res = responseRecorder();

  await routeHandler('patch', '/:id/confirm-resolution')(
    { params: { id: '41' }, user: { id: 7, role: 'inventory', branch: 'NY' } },
    res,
    (error) => { throw error; }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'packed');
  assert.equal(sqlCalls.some((sql) => sql.includes('resolution_confirmed = true')), false);
});
