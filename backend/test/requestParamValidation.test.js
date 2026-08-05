const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

process.env.JWT_SECRET = 'request-param-validation-test-secret-with-more-than-32-characters';
process.env.DATABASE_SSL = 'false';

const pool = require('../src/db/pool');
const { parseId, parseEnumParam } = require('../src/utils/requestParams');
const transfersRouter = require('../src/routes/transfers');
const stockRechecksRouter = require('../src/routes/stockRechecks');
const repsRouter = require('../src/routes/reps');
const requestsRouter = require('../src/routes/requests');

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
    headers: {},
    sent: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    send(payload) { this.sent = payload; return this; },
  };
}

/** Any database access at all is a failure: the guard must reject first. */
function forbidDatabase(t) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const attempts = [];
  pool.query = async (sql) => { attempts.push(String(sql).trim()); throw new Error('database must not be reached'); };
  pool.connect = async () => { attempts.push('CONNECT'); throw new Error('database must not be reached'); };
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  return attempts;
}

async function invoke(handler, request) {
  const res = responseRecorder();
  let nextError;
  await handler(
    { user: { id: 3, role: 'inventory', salesRepId: 12 }, ip: '10.0.0.9', params: {}, body: {}, query: {}, ...request },
    res,
    (error) => { nextError = error; }
  );
  return { res, nextError };
}

test('parseId accepts only positive safe integers written in plain decimal', () => {
  assert.equal(parseId('1'), 1);
  assert.equal(parseId('42'), 42);
  assert.equal(parseId(42), 42);
  assert.equal(parseId('007'), 7);

  for (const rejected of [
    'abc', '', '   ', '0', '-1', '-0', '1.5', '1e3', '0x10', '+5', ' 5 ', '5abc',
    '9007199254740993', null, undefined, NaN, Infinity, 1.5, -3, 0, {}, [], true,
  ]) {
    assert.equal(parseId(rejected), null, `parseId(${JSON.stringify(rejected)}) must be null`);
  }
});

test('parseEnumParam returns the fallback only when the value is absent, never when it is wrong', () => {
  const allowed = ['pending', 'consumed'];
  assert.equal(parseEnumParam('pending', allowed, 'pending'), 'pending');
  assert.equal(parseEnumParam(undefined, allowed, 'pending'), 'pending');
  assert.equal(parseEnumParam('', allowed, 'pending'), 'pending');
  assert.equal(parseEnumParam('bogus', allowed, 'pending'), null);
  assert.equal(parseEnumParam(['pending'], allowed, 'pending'), null);
});

test('a non-numeric shipping-label id is refused before any database work', async (t) => {
  const attempts = forbidDatabase(t);

  const { res, nextError } = await invoke(
    routeHandler(transfersRouter, 'get', '/:id/shipping-label'),
    { params: { id: 'abc' } }
  );

  assert.equal(nextError, undefined, 'an invalid id must not become a 500');
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /request/i);
  assert.deepEqual(attempts, [], 'NaN must never reach a query parameter');
});

test('a negative or zero request id is refused rather than silently matching nothing', async (t) => {
  const attempts = forbidDatabase(t);

  for (const id of ['0', '-1']) {
    const { res, nextError } = await invoke(
      routeHandler(transfersRouter, 'patch', '/:id/status'),
      { params: { id }, body: { action: 'pack' } }
    );
    assert.equal(nextError, undefined, `id ${id} must not become a 500`);
    assert.equal(res.statusCode, 400, `id ${id} must be rejected`);
  }
  assert.deepEqual(attempts, []);
});

test('an unknown stock-recheck queue state is rejected instead of silently listing pending', async (t) => {
  const attempts = forbidDatabase(t);

  const { res, nextError } = await invoke(
    routeHandler(stockRechecksRouter, 'get', '/queue'),
    { query: { state: 'everything' } }
  );

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /pending/, 'the error must name the allowed states');
  assert.deepEqual(attempts, []);
});

test('creating a sales rep validates the name and restricts the branch to a real one', async (t) => {
  const attempts = forbidDatabase(t);

  const rejected = [
    { name: 'Valid Name', branch: 'XX' },
    { name: 'Valid Name', branch: 'ny' },
    { name: '   ', branch: 'NY' },
    { name: [], branch: 'NY' },
    { name: { first: 'x' }, branch: 'NY' },
    { name: 'x'.repeat(201), branch: 'NY' },
    { name: 'Valid Name', branch: ['NY'] },
  ];

  for (const body of rejected) {
    const { res, nextError } = await invoke(
      routeHandler(repsRouter, 'post', '/'),
      { user: { id: 3, role: 'admin' }, body }
    );
    assert.equal(nextError, undefined, `${JSON.stringify(body)} must not become a 500`);
    assert.equal(res.statusCode, 400, `${JSON.stringify(body)} must be rejected`);
  }
  assert.deepEqual(attempts, [], 'no invalid rep may reach an INSERT');
});

test('a non-numeric stone id is refused instead of reaching Postgres as text', async (t) => {
  const attempts = forbidDatabase(t);

  const { res, nextError } = await invoke(
    routeHandler(requestsRouter, 'patch', '/:id/stones/:stoneId'),
    { params: { id: '5', stoneId: 'abc' }, body: { field: 'stone_found', value: true } }
  );

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(attempts, []);
});

test('no route reads a path parameter without the shared positive-integer guard', async () => {
  const directory = path.resolve(__dirname, '../src/routes');
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.js'));

  for (const name of files) {
    const source = await fs.readFile(path.join(directory, name), 'utf8');
    // Both historical shapes reached the database with raw request text:
    // `Number(req.params.id)` produced NaN, and destructuring passed the
    // string straight through to a query parameter.
    for (const [pattern, hint] of [
      [/Number\(req\.params/, 'Number(req.params...)'],
      [/const\s*\{[^}]*\}\s*=\s*req\.params/, 'destructuring req.params'],
    ]) {
      assert.equal(
        pattern.test(source),
        false,
        `${name}: parse path parameters with parseId, not ${hint}`
      );
    }
  }
});
