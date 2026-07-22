const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('production start invokes the Next JavaScript CLI instead of a Windows cmd shim', () => {
  const script = fs.readFileSync(path.join(__dirname, 'start.js'), 'utf8');
  assert.match(script, /require\.resolve\('next\/dist\/bin\/next'\)/);
  assert.doesNotMatch(script, /next\.cmd/);
});
