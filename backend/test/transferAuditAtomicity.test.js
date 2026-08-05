const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

process.env.JWT_SECRET = 'transfer-audit-atomicity-test-secret-with-more-than-32-characters';
process.env.DATABASE_SSL = 'false';

const pool = require('../src/db/pool');
const transfersRouter = require('../src/routes/transfers');

const ACTOR = { id: 77, role: 'inventory', salesRepId: 12 };
const ACTOR_BRANCH = 'NY';

// A cross-branch internal transfer sitting at the first step, with the ERP
// branch transfer already issued so `pack` is the one legal next action.
const BASE_REQUEST = Object.freeze({
  id: 5,
  sales_rep_id: 12,
  destination_branch: 'LA',
  fulfillment_branch: 'NY',
  cross_branch: true,
  delivery_route: 'internal_transfer',
  transfer_status: 'awaiting_source',
  status: 'active',
  request_scope: 'stone_and_cert',
  resolution_confirmed: false,
  paperwork_type: 'none',
  workflow_version: 2,
  erp_transfer_confirmed: true,
  erp_transfer_received: false,
  erp_receive_requested_at: null,
  branch: 'LA',
  delivery_branch: 'LA',
  has_label: false,
  has_paperwork: false,
});

function routeHandler(router, method, routePath) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method]
  );
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

/**
 * Fake pool where committed state only changes on COMMIT.
 *
 * `pool.query` serves the pre-transaction branch lookup and nothing else: any
 * audit write that escapes the transaction lands there and is recorded as a
 * violation rather than silently succeeding.
 */
function installTransactionalPool(t, { failAuditAttempt = null, retryAuditOnce = false, request = {} } = {}) {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;

  let committed = { ...BASE_REQUEST, ...request, audit_log: 0 };
  let auditAttempts = 0;
  const calls = [];
  const outsideTransaction = [];

  pool.query = async (sql, params = []) => {
    const normalized = String(sql).trim();
    if (normalized.startsWith('SELECT sr.branch FROM users u')) {
      return { rows: [{ branch: ACTOR_BRANCH }] };
    }
    outsideTransaction.push({ sql: normalized, params });
    if (normalized.startsWith('INSERT INTO audit_log')) {
      auditAttempts += 1;
      if (auditAttempts === failAuditAttempt) throw new Error('forced audit failure');
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('UPDATE requests')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected pool query outside a transaction: ${normalized}`);
  };

  pool.connect = async () => {
    let inFlight;
    return {
      release() {},
      async query(sql, params = []) {
        const normalized = String(sql).trim();
        calls.push({ sql: normalized, params });

        if (normalized === 'BEGIN' || normalized.startsWith('BEGIN ')) {
          inFlight = { ...committed };
          return { rows: [] };
        }
        if (normalized === 'COMMIT') { committed = inFlight; return { rows: [] }; }
        if (normalized === 'ROLLBACK') { inFlight = undefined; return { rows: [] }; }

        if (/^SELECT[\s\S]*FROM requests[\s\S]*FOR UPDATE$/.test(normalized)
            || /^SELECT r\.id[\s\S]*FOR UPDATE$/.test(normalized)) {
          return { rows: [{ ...inFlight }] };
        }
        if (normalized.startsWith('UPDATE requests SET transfer_status')) {
          inFlight.transfer_status = params[1];
          inFlight.status = params[2];
          return { rows: [], rowCount: 1 };
        }
        if (normalized.startsWith('UPDATE requests')) {
          inFlight.erp_transfer_confirmed = true;
          return { rows: [], rowCount: 1 };
        }
        if (normalized.startsWith('INSERT INTO stone_movements')) {
          inFlight.movements = (inFlight.movements || 0) + 1;
          return { rows: [{ id: 900 }], rowCount: 1 };
        }
        if (normalized.startsWith('INSERT INTO audit_log')) {
          auditAttempts += 1;
          if (auditAttempts === failAuditAttempt || (retryAuditOnce && auditAttempts === 1)) {
            const error = new Error('forced audit failure');
            if (retryAuditOnce) error.code = '40001';
            throw error;
          }
          inFlight.audit_log += 1;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected transaction SQL: ${normalized}`);
      },
    };
  };

  t.after(() => {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  });

  return {
    calls,
    outsideTransaction,
    get committed() { return { ...committed }; },
    get auditAttempts() { return auditAttempts; },
    index(predicate) { return calls.findIndex((call) => predicate(call.sql)); },
  };
}

async function invoke(handler, request) {
  const res = responseRecorder();
  let nextError;
  await handler(
    { user: ACTOR, ip: '127.0.0.1', params: {}, body: {}, query: {}, ...request },
    res,
    (error) => { nextError = error; }
  );
  return { res, nextError };
}

const patchStatus = () => routeHandler(transfersRouter, 'patch', '/:id/status');
const patchErpTransfer = () => routeHandler(transfersRouter, 'patch', '/:id/erp-transfer');
const patchPaperwork = () => routeHandler(transfersRouter, 'patch', '/:id/paperwork');

test('transfer status change audits inside the same transaction as the mutation', async (t) => {
  const database = installTransactionalPool(t);

  const { res, nextError } = await invoke(patchStatus(), {
    params: { id: '5' },
    body: { action: 'pack' },
  });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.transferStatus, 'packed');

  const auditIndex = database.index((sql) => sql.startsWith('INSERT INTO audit_log'));
  const commitIndex = database.index((sql) => sql === 'COMMIT');
  assert.ok(auditIndex >= 0, 'the audit insert must run on the transaction client');
  assert.ok(auditIndex < commitIndex, 'the audit insert must occur before COMMIT');
  assert.deepEqual(
    database.calls[auditIndex].params.slice(0, 5),
    [ACTOR.id, 'transfer.status_changed', 'request', '5', '127.0.0.1']
  );
  assert.deepEqual(database.outsideTransaction, []);
  assert.equal(database.committed.transfer_status, 'packed');
  assert.equal(database.committed.audit_log, 1);
});

test('a failed transfer audit write rolls the status change back instead of committing it unrecorded', async (t) => {
  const database = installTransactionalPool(t, { failAuditAttempt: 1 });

  const { res, nextError } = await invoke(patchStatus(), {
    params: { id: '5' },
    body: { action: 'pack' },
  });

  assert.equal(res.body, null, 'a failed audit must not report success to the caller');
  assert.match(nextError.message, /forced audit failure/);
  assert.ok(database.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(database.committed.transfer_status, 'awaiting_source');
  assert.equal(database.committed.audit_log, 0);
  assert.equal(database.committed.movements, undefined);
});

test('a serialization conflict on the transfer audit retries the whole transaction exactly once', async (t) => {
  const database = installTransactionalPool(t, { retryAuditOnce: true });

  const { res, nextError } = await invoke(patchStatus(), {
    params: { id: '5' },
    body: { action: 'pack' },
  });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(database.auditAttempts, 2);
  assert.equal(database.calls.filter((call) => call.sql === 'BEGIN').length, 2);
  assert.equal(database.calls.filter((call) => call.sql === 'ROLLBACK').length, 1);
  assert.equal(database.calls.filter((call) => call.sql === 'COMMIT').length, 1);
  assert.equal(database.committed.transfer_status, 'packed');
  assert.equal(database.committed.audit_log, 1, 'the retry must leave exactly one audit row');
});

test('a failed ERP issue audit write rolls the ERP confirmation back', async (t) => {
  const database = installTransactionalPool(t, { failAuditAttempt: 1 });

  const { res, nextError } = await invoke(patchErpTransfer(), { params: { id: '5' } });

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced audit failure/);
  assert.ok(database.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(database.committed.audit_log, 0);
  assert.deepEqual(database.outsideTransaction, []);
});

test('paperwork type change and its audit share one transaction', async (t) => {
  // The legacy paperwork-type field only applies to a v1 customer shipment.
  const database = installTransactionalPool(t, {
    request: { workflow_version: 1, delivery_route: 'customer_ship' },
  });

  const { res, nextError } = await invoke(patchPaperwork(), {
    params: { id: '5' },
    body: { paperworkType: 'invoice' },
    user: { ...ACTOR, role: 'sales_rep' },
  });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(database.outsideTransaction, [], 'no write may bypass the transaction');
  const auditIndex = database.index((sql) => sql.startsWith('INSERT INTO audit_log'));
  const commitIndex = database.index((sql) => sql === 'COMMIT');
  assert.ok(auditIndex >= 0 && auditIndex < commitIndex);
  assert.equal(database.committed.audit_log, 1);
});

test('every transfer and stock-recheck audit call passes an explicit transaction client', async () => {
  const files = ['../src/routes/transfers.js', '../src/routes/stockRechecks.js'];

  for (const relative of files) {
    const source = await fs.readFile(path.resolve(__dirname, relative), 'utf8');
    // Each segment holds exactly one call, so a `}, client)` match cannot be
    // borrowed from a neighbouring call that omits the client.
    const segments = source.split('writeAudit(').slice(1);
    assert.ok(segments.length > 0, `${relative}: expected at least one writeAudit call`);

    segments.forEach((segment, index) => {
      // The default `queryable = pool` argument would put the audit outside
      // the transaction, so every call must close with `}, client)`.
      assert.match(
        segment,
        /^[\s\S]*?\},\s*client\s*\)/,
        `${relative}: writeAudit call #${index + 1} must pass the transaction client`
      );
    });
  }
});
