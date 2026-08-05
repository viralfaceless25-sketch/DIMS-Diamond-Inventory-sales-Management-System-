const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = 'account-audit-atomicity-test-secret-with-more-than-32-characters';
process.env.DATABASE_SSL = 'false';

const pool = require('../src/db/pool');
const adminRouter = require('../src/routes/admin');
const authRouter = require('../src/routes/auth');

const ADMIN = { id: 9, role: 'admin' };
const TARGET_USER_ID = 42;
const CURRENT_PASSWORD = 'CurrentPassw0rd!';
const NEW_PASSWORD = 'BrandNewPassw0rd!';

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
 * Fake account store. Committed state only advances on COMMIT, so a rolled
 * back transaction is observable as unchanged committed state.
 */
function installAccountPool(t, { failAudit = false, currentHash } = {}) {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;

  let committed = {
    is_active: true,
    token_version: 3,
    failed_login_attempts: 0,
    password_hash: currentHash || null,
    must_change_password: true,
    audit_log: 0,
    users: 1,
    sales_reps: 0,
  };
  const poolCalls = [];
  const calls = [];

  function applyWrite(state, normalized, params) {
    if (normalized.startsWith('UPDATE users SET is_active')) {
      state.is_active = params[1];
      state.token_version += 1;
      state.failed_login_attempts = 0;
      return { rows: [{ id: params[0], isActive: params[1] }], rowCount: 1 };
    }
    if (normalized.startsWith('UPDATE users SET password_hash')) {
      state.password_hash = params[1];
      state.token_version += 1;
      state.must_change_password = normalized.includes('must_change_password = true');
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('UPDATE users SET token_version')) {
      state.token_version += 1;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('UPDATE\n     users') || /^UPDATE\s+users\s*$/m.test(normalized.split('\n')[0])) {
      // Lockout accounting: failed-attempt increment or successful reset.
      if (normalized.includes('failed_login_attempts = 0')) {
        state.failed_login_attempts = 0;
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      state.failed_login_attempts += 1;
      return { rows: [{ id: params[0], failed_login_attempts: state.failed_login_attempts, locked_until: null }], rowCount: 1 };
    }
    if (normalized.startsWith('INSERT INTO sales_reps')) {
      state.sales_reps += 1;
      return { rows: [{ id: 501 }], rowCount: 1 };
    }
    if (normalized.startsWith('INSERT INTO users')) {
      state.users += 1;
      return {
        rows: [{ id: 777, email: 'new.person@example.com', role: 'sales_rep', salesRepId: 501, isActive: true, mustChangePassword: true }],
        rowCount: 1,
      };
    }
    if (normalized.startsWith('INSERT INTO audit_log')) {
      if (failAudit) throw new Error('forced audit failure');
      state.audit_log += 1;
      return { rows: [], rowCount: 1 };
    }
    return null;
  }

  pool.query = async (sql, params = []) => {
    const normalized = String(sql).trim();
    poolCalls.push({ sql: normalized, params });

    if (normalized.startsWith('SELECT u.id, u.email, u.password_hash')) {
      return {
        rows: [{
          id: TARGET_USER_ID,
          email: 'person@example.com',
          password_hash: committed.password_hash,
          role: 'sales_rep',
          sales_rep_id: 12,
          is_active: committed.is_active,
          must_change_password: false,
          token_version: committed.token_version,
          failed_login_attempts: committed.failed_login_attempts,
          locked_until: null,
          rep_name: 'Person',
          rep_branch: 'NY',
        }],
      };
    }
    if (normalized.startsWith('SELECT password_hash FROM users')) {
      return { rows: [{ password_hash: committed.password_hash }] };
    }

    // Writes issued straight through the pool commit immediately — that is
    // exactly what the login lockout path is supposed to do.
    const result = applyWrite(committed, normalized, params);
    if (result) return result;
    throw new Error(`Unexpected pool query: ${normalized}`);
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

        const result = applyWrite(inFlight, normalized, params);
        if (result) return result;
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
    poolCalls,
    get committed() { return { ...committed }; },
    auditedInTransaction() {
      const auditIndex = calls.findIndex((call) => call.sql.startsWith('INSERT INTO audit_log'));
      const commitIndex = calls.findIndex((call) => call.sql === 'COMMIT');
      return auditIndex >= 0 && commitIndex >= 0 && auditIndex < commitIndex;
    },
  };
}

async function invoke(handler, request) {
  const res = responseRecorder();
  let nextError;
  await handler(
    { user: ADMIN, ip: '10.0.0.4', params: {}, body: {}, query: {}, ...request },
    res,
    (error) => { nextError = error; }
  );
  return { res, nextError };
}

test('a failed audit write rolls back an account deactivation instead of silently revoking sessions', async (t) => {
  const database = installAccountPool(t, { failAudit: true });

  const { res, nextError } = await invoke(
    routeHandler(adminRouter, 'patch', '/users/:id/status'),
    { params: { id: String(TARGET_USER_ID) }, body: { isActive: false } }
  );

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced audit failure/);
  assert.ok(database.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(database.committed.is_active, true, 'the account must stay active');
  assert.equal(database.committed.token_version, 3, 'sessions must not be revoked without an audit record');
  assert.equal(database.committed.audit_log, 0);
});

test('an account deactivation audits inside the same transaction as the status change', async (t) => {
  const database = installAccountPool(t);

  const { res, nextError } = await invoke(
    routeHandler(adminRouter, 'patch', '/users/:id/status'),
    { params: { id: String(TARGET_USER_ID) }, body: { isActive: false } }
  );

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.ok(database.auditedInTransaction(), 'the audit insert must run before COMMIT');
  assert.equal(database.committed.is_active, false);
  assert.equal(database.committed.audit_log, 1);
});

test('a failed audit write rolls back an admin password reset', async (t) => {
  const database = installAccountPool(t, { failAudit: true });

  const { res, nextError } = await invoke(
    routeHandler(adminRouter, 'post', '/users/:id/reset-password'),
    { params: { id: String(TARGET_USER_ID) }, body: { password: NEW_PASSWORD } }
  );

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced audit failure/);
  assert.equal(database.committed.password_hash, null, 'the password must not change');
  assert.equal(database.committed.token_version, 3);
  assert.equal(database.committed.audit_log, 0);
});

test('a failed audit write rolls back user creation, including the sales rep row', async (t) => {
  const database = installAccountPool(t, { failAudit: true });

  const { res, nextError } = await invoke(
    routeHandler(adminRouter, 'post', '/users'),
    {
      body: {
        email: 'New.Person@example.com',
        role: 'sales_rep',
        password: NEW_PASSWORD,
        repName: 'New Person',
        branch: 'NY',
      },
    }
  );

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced audit failure/);
  assert.equal(database.committed.users, 1, 'no user may exist without its creation audit');
  assert.equal(database.committed.sales_reps, 0, 'the sales rep row must roll back with it');
  assert.equal(database.committed.audit_log, 0);
});

test('a failed audit write rolls back a self-service password change', async (t) => {
  const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
  const database = installAccountPool(t, { failAudit: true, currentHash: hash });

  const { res, nextError } = await invoke(
    routeHandler(authRouter, 'post', '/change-password'),
    {
      user: { id: TARGET_USER_ID, role: 'sales_rep' },
      body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    }
  );

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced audit failure/);
  assert.equal(database.committed.password_hash, hash, 'the old password must still be in force');
  assert.equal(database.committed.token_version, 3);
});

test('a failed audit write rolls back logout-all rather than half-revoking sessions', async (t) => {
  const database = installAccountPool(t, { failAudit: true });

  const { res, nextError } = await invoke(
    routeHandler(authRouter, 'post', '/logout-all'),
    { user: { id: TARGET_USER_ID, role: 'sales_rep' } }
  );

  assert.equal(res.body, null);
  assert.match(nextError.message, /forced audit failure/);
  assert.equal(database.committed.token_version, 3);
});

test('a failed audit write must NOT roll back the login lockout counter', async (t) => {
  // Deliberate asymmetry: binding the failed-attempt increment to the audit
  // write would turn an unavailable audit table into unlimited password
  // attempts. The counter has to survive the audit failure.
  const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
  const database = installAccountPool(t, { failAudit: true, currentHash: hash });

  const { nextError } = await invoke(
    routeHandler(authRouter, 'post', '/login'),
    { body: { email: 'person@example.com', password: 'WrongPassword!' } }
  );

  assert.match(nextError.message, /forced audit failure/);
  assert.equal(
    database.committed.failed_login_attempts,
    1,
    'the failed attempt must be recorded even though the audit write failed'
  );
  assert.equal(
    database.calls.length,
    0,
    'the login path must not open a transaction that could roll the counter back'
  );
});
