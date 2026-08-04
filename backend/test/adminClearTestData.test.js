const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'admin-clear-test-data-test-secret-with-more-than-32-characters';
process.env.DATABASE_SSL = 'false';

const pool = require('../src/db/pool');
const router = require('../src/routes/admin');

const ORIGINAL_COUNTS = {
  requests: 3,
  request_stones: 4,
  stone_movements: 5,
  shipment_receipts: 6,
  stock_recheck_requests: 7,
  loose_diamonds: 8,
  jewelry_pieces: 9,
  users: 10,
  sales_reps: 11,
  branches: 3,
  audit_log: 2,
};

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

function installTransactionalPool(t, { failDelete = null, failAuditAttempt = null, retryAuditOnce = false } = {}) {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  let state = { ...ORIGINAL_COUNTS };
  let auditAttempts = 0;
  const calls = [];
  let externalQueries = 0;

  pool.query = async () => {
    externalQueries += 1;
    throw new Error('cleanup must not issue audit writes through the pool outside its transaction');
  };
  pool.connect = async () => {
    let transactionState;
    return {
      release() {},
      async query(sql, params = []) {
        calls.push({ sql, params });
        const normalized = sql.trim();
        if (normalized === 'BEGIN') {
          transactionState = { ...state };
          return { rows: [] };
        }
        if (normalized === 'COMMIT') {
          state = transactionState;
          return { rows: [] };
        }
        if (normalized === 'ROLLBACK') return { rows: [] };

        const countMatch = normalized.match(/^SELECT count\(\*\) FROM ([a-z_]+)$/i);
        if (countMatch) return { rows: [{ count: String(transactionState[countMatch[1]]) }] };

        const deleteMatch = normalized.match(/^DELETE FROM ([a-z_]+)$/i);
        if (deleteMatch) {
          if (deleteMatch[1] === failDelete) throw new Error(`forced delete failure for ${failDelete}`);
          transactionState[deleteMatch[1]] = 0;
          return { rows: [], rowCount: 1 };
        }

        if (normalized.startsWith('INSERT INTO audit_log')) {
          auditAttempts += 1;
          if (auditAttempts === failAuditAttempt || (retryAuditOnce && auditAttempts === 1)) {
            const error = new Error('forced audit failure');
            if (retryAuditOnce) error.code = '40001';
            throw error;
          }
          transactionState.audit_log += 1;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected transaction SQL: ${sql}`);
      },
    };
  };
  t.after(() => {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  });

  return {
    calls,
    get externalQueries() { return externalQueries; },
    get state() { return { ...state }; },
    get auditAttempts() { return auditAttempts; },
  };
}

async function invokeClearData(request) {
  const res = responseRecorder();
  let nextError;
  await routeHandler('post', '/clear-test-data')(
    { user: { id: 81, role: 'admin' }, ip: '127.0.0.1', ...request },
    res,
    (error) => { nextError = error; }
  );
  return { res, nextError };
}

test('dry run reports every cleanup table and does not mutate data or audit history', async (t) => {
  const database = installTransactionalPool(t);

  const { res, nextError } = await invokeClearData({ query: { dryRun: 'true' }, body: {} });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    dryRun: true,
    requestsToDelete: 3,
    requestStonesToDelete: 4,
    stoneMovementsToDelete: 5,
    shipmentReceiptsToDelete: 6,
    stockRechecksToDelete: 7,
    looseDiamondsToDelete: 8,
    jewelryPiecesToDelete: 9,
    usersKept: 10,
    salesRepsKept: 11,
  });
  assert.deepEqual(database.state, ORIGINAL_COUNTS);
  assert.equal(database.calls.some((call) => /^DELETE\b|^INSERT\b/.test(call.sql.trim())), false);
  assert.equal(database.externalQueries, 0);
});

test('audit failure rolls the complete cleanup back instead of committing deletions without evidence', async (t) => {
  const database = installTransactionalPool(t, { failAuditAttempt: 1 });

  const { res, nextError } = await invokeClearData({ query: {}, body: { confirm: 'DELETE TEST DATA' } });

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced audit failure/);
  assert.deepEqual(database.state, ORIGINAL_COUNTS);
  assert.equal(database.externalQueries, 0);
  assert.ok(database.calls.some((call) => call.sql.trim() === 'ROLLBACK'));
});

test('real cleanup deletes every workflow and stock table in FK-safe order then audits before commit', async (t) => {
  const database = installTransactionalPool(t);

  const { res, nextError } = await invokeClearData({ query: {}, body: { confirm: 'DELETE TEST DATA' } });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dryRun, false);
  assert.deepEqual(
    database.calls
      .filter((call) => /^DELETE FROM /.test(call.sql.trim()))
      .map((call) => call.sql.trim().slice('DELETE FROM '.length)),
    [
      'shipment_receipts',
      'stock_recheck_requests',
      'stone_movements',
      'request_stones',
      'requests',
      'loose_diamonds',
      'jewelry_pieces',
    ]
  );
  const auditIndex = database.calls.findIndex((call) => call.sql.trim().startsWith('INSERT INTO audit_log'));
  const commitIndex = database.calls.findIndex((call) => call.sql.trim() === 'COMMIT');
  assert.ok(auditIndex >= 0 && auditIndex < commitIndex, 'the audit insert must occur before transaction commit');
  assert.deepEqual(database.calls[auditIndex].params.slice(0, 5), [81, 'admin.clear_test_data', 'system', null, '127.0.0.1']);
  assert.deepEqual(JSON.parse(database.calls[auditIndex].params[5]), {
    requestsToDelete: 3,
    requestStonesToDelete: 4,
    stoneMovementsToDelete: 5,
    shipmentReceiptsToDelete: 6,
    stockRechecksToDelete: 7,
    looseDiamondsToDelete: 8,
    jewelryPiecesToDelete: 9,
    usersKept: 10,
    salesRepsKept: 11,
  });
  assert.deepEqual(database.state, {
    ...ORIGINAL_COUNTS,
    requests: 0,
    request_stones: 0,
    stone_movements: 0,
    shipment_receipts: 0,
    stock_recheck_requests: 0,
    loose_diamonds: 0,
    jewelry_pieces: 0,
    audit_log: 3,
  });
  assert.equal(database.externalQueries, 0);
});

test('delete failure rolls back before an audit record can be committed', async (t) => {
  const database = installTransactionalPool(t, { failDelete: 'request_stones' });

  const { res, nextError } = await invokeClearData({ query: {}, body: { confirm: 'DELETE TEST DATA' } });

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced delete failure/);
  assert.deepEqual(database.state, ORIGINAL_COUNTS);
  assert.equal(database.auditAttempts, 0);
  assert.ok(database.calls.some((call) => call.sql.trim() === 'ROLLBACK'));
});

test('serialization retry reruns counts, deletes, and audit together without duplicate committed audit rows', async (t) => {
  const database = installTransactionalPool(t, { retryAuditOnce: true });

  const { res, nextError } = await invokeClearData({ query: {}, body: { confirm: 'DELETE TEST DATA' } });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(database.auditAttempts, 2);
  assert.equal(database.calls.filter((call) => /^SELECT count\(\*\)/.test(call.sql.trim())).length, 18);
  assert.equal(database.calls.filter((call) => call.sql.trim() === 'ROLLBACK').length, 1);
  assert.equal(database.calls.filter((call) => call.sql.trim() === 'COMMIT').length, 1);
  assert.equal(database.state.audit_log, 3);
  assert.equal(database.externalQueries, 0);
});

test('real cleanup still requires the exact confirmation phrase before opening a transaction', async (t) => {
  const database = installTransactionalPool(t);

  const { res, nextError } = await invokeClearData({ query: {}, body: { confirm: 'delete test data' } });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /DELETE TEST DATA/);
  assert.deepEqual(database.state, ORIGINAL_COUNTS);
  assert.deepEqual(database.calls, []);
});

test('cleanup policy covers all schema-defined request workflow tables and documents preserved data', () => {
  const { TEST_DATA_CLEANUP_TABLES, PRESERVED_TEST_DATA_TABLES } = require('../src/services/testDataCleanupService');
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  const cleanupTables = TEST_DATA_CLEANUP_TABLES.map(({ table }) => table);

  for (const table of ['requests', 'request_stones', 'stone_movements', 'shipment_receipts', 'stock_recheck_requests']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.ok(cleanupTables.includes(table), `${table} must be cleared with request workflow data`);
  }
  assert.deepEqual(cleanupTables, [
    'shipment_receipts',
    'stock_recheck_requests',
    'stone_movements',
    'request_stones',
    'requests',
    'loose_diamonds',
    'jewelry_pieces',
  ]);
  assert.deepEqual(PRESERVED_TEST_DATA_TABLES, [
    'users',
    'sales_reps',
    'branches',
    'audit_log',
    'request_paperwork_files (deleted by requests cascade)',
    'request_shipping_labels (deleted by requests cascade)',
  ]);
});
