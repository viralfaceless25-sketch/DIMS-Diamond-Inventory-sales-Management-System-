const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const bcrypt = require('bcryptjs');

process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'auth-lockout-concurrency-test-secret-more-than-32-characters';

const {
  MAX_FAILED_LOGINS,
  recordFailedLogin,
  resetSuccessfulLogin,
} = require('../src/services/loginLockoutService');

function createAtomicUserStore({ failedLoginAttempts = 0, lockedUntil = null, lockExpired = false } = {}) {
  let state = { failedLoginAttempts, lockedUntil, lockExpired };
  let queue = Promise.resolve();
  const queryCalls = [];
  const lockWindow = '2030-01-01T00:15:00.000Z';

  function query(sql, params) {
    queryCalls.push({ sql, params });
    const operation = queue.then(() => {
      if (sql.includes('failed_login_attempts + 1')) {
        assert.match(sql, /failed_login_attempts = CASE/);
        assert.match(sql, /WHEN locked_until IS NOT NULL AND locked_until <= now\(\) THEN 1/);
        assert.match(sql, /failed_login_attempts \+ 1 = \$2/);
        assert.match(sql, /locked_until IS NULL OR locked_until <= now\(\)/);
        if (state.lockedUntil && !state.lockExpired) return { rows: [] };

        const nextAttempts = state.lockExpired ? 1 : state.failedLoginAttempts + 1;
        state = {
          failedLoginAttempts: nextAttempts,
          lockedUntil: nextAttempts === MAX_FAILED_LOGINS ? lockWindow : null,
          lockExpired: false,
        };
        return { rows: [{ id: 7, failed_login_attempts: state.failedLoginAttempts, locked_until: state.lockedUntil }] };
      }

      if (sql.includes('failed_login_attempts = 0')) {
        assert.match(sql, /locked_until IS NULL OR locked_until <= now\(\)/);
        if (state.lockedUntil) return { rows: [] };

        state = { failedLoginAttempts: 0, lockedUntil: null, lockExpired: false };
        return { rows: [{ id: 7, failed_login_attempts: 0, locked_until: null }] };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });
    queue = operation.catch(() => {});
    return operation;
  }

  return {
    query,
    queryCalls: () => [...queryCalls],
    state: () => ({
      failedLoginAttempts: state.failedLoginAttempts,
      lockedUntil: state.lockedUntil,
    }),
  };
}

test('N simultaneous failed-login writes increment atomically through the threshold and preserve one lock window', async () => {
  const store = createAtomicUserStore();
  const results = await Promise.all(
    Array.from({ length: MAX_FAILED_LOGINS + 4 }, () => recordFailedLogin(7, store))
  );

  assert.equal(results.filter(Boolean).length, MAX_FAILED_LOGINS);
  assert.deepEqual(store.state(), {
    failedLoginAttempts: MAX_FAILED_LOGINS,
    lockedUntil: '2030-01-01T00:15:00.000Z',
  });
  assert.equal(store.queryCalls().length, MAX_FAILED_LOGINS + 4);
});

test('a queued failure after the threshold lock sees the current lock and cannot increment or extend it', async () => {
  const store = createAtomicUserStore({ failedLoginAttempts: MAX_FAILED_LOGINS - 1 });
  const thresholdAttempt = recordFailedLogin(7, store);
  const queuedAttempt = recordFailedLogin(7, store);

  assert.ok(await thresholdAttempt);
  assert.equal(await queuedAttempt, null);
  assert.deepEqual(store.state(), {
    failedLoginAttempts: MAX_FAILED_LOGINS,
    lockedUntil: '2030-01-01T00:15:00.000Z',
  });
});

test('an expired lockout restarts its counter atomically so the next threshold creates a fresh lock window', async () => {
  const store = createAtomicUserStore({
    failedLoginAttempts: MAX_FAILED_LOGINS,
    lockedUntil: '2020-01-01T00:15:00.000Z',
    lockExpired: true,
  });

  await recordFailedLogin(7, store);
  assert.deepEqual(store.state(), { failedLoginAttempts: 1, lockedUntil: null });

  await Promise.all(Array.from({ length: MAX_FAILED_LOGINS - 1 }, () => recordFailedLogin(7, store)));
  assert.deepEqual(store.state(), {
    failedLoginAttempts: MAX_FAILED_LOGINS,
    lockedUntil: '2030-01-01T00:15:00.000Z',
  });
});

test('concurrent success and failure operations serialize to their database order without stale assignments', async () => {
  const successThenFailure = createAtomicUserStore({ failedLoginAttempts: 4 });
  await Promise.all([resetSuccessfulLogin(7, successThenFailure), recordFailedLogin(7, successThenFailure)]);
  assert.deepEqual(successThenFailure.state(), { failedLoginAttempts: 1, lockedUntil: null });

  const failureThenSuccess = createAtomicUserStore({ failedLoginAttempts: 4 });
  const [failure, reset] = await Promise.all([
    recordFailedLogin(7, failureThenSuccess),
    resetSuccessfulLogin(7, failureThenSuccess),
  ]);
  assert.ok(failure);
  assert.equal(reset, null);
  assert.deepEqual(failureThenSuccess.state(), {
    failedLoginAttempts: MAX_FAILED_LOGINS,
    lockedUntil: '2030-01-01T00:15:00.000Z',
  });
});

test('a currently locked login stays generic and does not compare bcrypt or mutate account state', async (t) => {
  const pool = require('../src/db/pool');
  const originalQuery = pool.query;
  const originalCompare = bcrypt.compare;
  const queries = [];
  let compareCalls = 0;
  pool.query = async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM users u')) {
      return { rows: [{
        id: 7,
        email: 'locked@example.test',
        password_hash: 'unused',
        role: 'admin',
        sales_rep_id: null,
        is_active: true,
        must_change_password: false,
        token_version: 0,
        failed_login_attempts: MAX_FAILED_LOGINS,
        locked_until: '2030-01-01T00:15:00.000Z',
        rep_name: null,
        rep_branch: null,
      }] };
    }
    if (sql.includes('INSERT INTO audit_log')) return { rows: [] };
    throw new Error(`Locked account unexpectedly mutated: ${sql}`);
  };
  bcrypt.compare = async () => {
    compareCalls += 1;
    return false;
  };
  t.after(() => {
    pool.query = originalQuery;
    bcrypt.compare = originalCompare;
  });

  const authRouter = require('../src/routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'locked@example.test', password: 'Aa1!valid-password' }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Incorrect email or password' });
  assert.equal(compareCalls, 0);
  assert.equal(queries.filter((sql) => sql.includes('UPDATE users')).length, 0);
  assert.equal(queries.filter((sql) => sql.includes('INSERT INTO audit_log')).length, 1);
});
