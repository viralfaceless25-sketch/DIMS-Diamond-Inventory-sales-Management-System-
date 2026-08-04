const test = require('node:test');
const assert = require('node:assert/strict');
const { passwordError } = require('../src/utils/passwordSecurity');

test('password validation enforces bcrypt\'s 72 UTF-8-byte boundary', () => {
  const atBoundary = `Aa1!${'a'.repeat(68)}`;
  const asciiOverBoundary = `Aa1!${'a'.repeat(69)}`;
  const multibyteOverBoundary = `Aa1!${'é'.repeat(35)}`;

  assert.equal(Buffer.byteLength(atBoundary, 'utf8'), 72);
  assert.equal(passwordError(atBoundary), null);
  assert.equal(passwordError(asciiOverBoundary), 'Password must be at most 72 UTF-8 bytes');
  assert.equal(passwordError(multibyteOverBoundary), 'Password must be at most 72 UTF-8 bytes');
});
