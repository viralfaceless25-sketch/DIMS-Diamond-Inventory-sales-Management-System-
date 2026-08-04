const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET ||= 'test-only-jwt-secret-with-at-least-32-characters';
const { authenticateToken, automaticRooms, resolveRoom } = require('../src/sockets');

test('socket authentication accepts only an active current token', async () => {
  const user = await authenticateToken('valid-token', {
    verify: () => ({ id: 7, tokenVersion: 3 }),
    query: async () => ({ rows: [{ id: 7, role: 'inventory', branch: 'NY', is_active: true, token_version: 3, must_change_password: false }] }),
  });
  assert.deepEqual(user, { id: 7, role: 'inventory', branch: 'NY' });

  await assert.rejects(() => authenticateToken('revoked-token', {
    verify: () => ({ id: 7, tokenVersion: 2 }),
    query: async () => ({ rows: [{ id: 7, role: 'inventory', branch: 'NY', is_active: true, token_version: 3, must_change_password: false }] }),
  }), /Invalid or expired socket session/);
});

test('sales reps can join only their own branch while inventory can watch its workflow', () => {
  assert.equal(resolveRoom({ role: 'sales_rep', branch: 'NY' }, 'NY'), 'branch:NY');
  assert.equal(resolveRoom({ role: 'sales_rep', branch: 'NY' }, 'LA'), null);
  assert.equal(resolveRoom({ role: 'sales_rep', branch: 'NY' }, 'ALL'), null);
  assert.equal(resolveRoom({ role: 'inventory', branch: 'NY' }, 'ALL'), 'branch:ALL');
  assert.equal(resolveRoom({ role: 'inventory', branch: 'NY' }, 'LA'), 'branch:LA');
  assert.equal(resolveRoom({ role: 'inventory', branch: 'NY' }, '../ALL'), null);
});

test('targeted rooms are derived only from authenticated identity', () => {
  assert.deepEqual(
    automaticRooms({ id: 7, role: 'inventory', branch: 'NY' }),
    ['user:7', 'inventory:NY']
  );
  assert.deepEqual(
    automaticRooms({ id: 8, role: 'sales_rep', branch: 'NY' }),
    ['user:8']
  );
  assert.deepEqual(automaticRooms({ id: 'bad', role: 'inventory', branch: '../ALL' }), []);
});
