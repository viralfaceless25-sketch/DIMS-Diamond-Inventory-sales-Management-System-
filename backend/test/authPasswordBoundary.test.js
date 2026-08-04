const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const bcrypt = require('bcryptjs');

process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'auth-password-boundary-test-secret-more-than-32-characters';

test('login rejects an over-boundary password before bcrypt comparison', async (t) => {
  const pool = require('../src/db/pool');
  const originalQuery = pool.query;
  const originalCompare = bcrypt.compare;
  let queryCalls = 0;
  let compareCalls = 0;
  pool.query = async () => {
    queryCalls += 1;
    throw new Error('Login should reject the password before querying the database');
  };
  bcrypt.compare = async () => {
    compareCalls += 1;
    return true;
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

  const { port } = server.address();
  for (const password of [`Aa1!${'a'.repeat(69)}`, `Aa1!${'a'.repeat(253)}`]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.test', password }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Incorrect email or password' });
  }
  assert.equal(queryCalls, 0);
  assert.equal(compareCalls, 0);
});
