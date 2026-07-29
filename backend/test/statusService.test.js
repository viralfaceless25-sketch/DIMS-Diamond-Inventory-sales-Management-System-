const test = require('node:test');
const assert = require('node:assert/strict');
const { isActive } = require('../src/services/statusService');

test('fulfilled and cancelled requests are both removed from active queues', () => {
  assert.equal(isActive('awaiting'), true);
  assert.equal(isActive('half_fulfilled'), true);
  assert.equal(isActive('fulfilled'), false);
  assert.equal(isActive('cancelled'), false);
});
