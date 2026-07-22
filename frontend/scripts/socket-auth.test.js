const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/socket.ts'), 'utf8');

test('realtime connection authenticates with the current session token', () => {
  assert.match(source, /import \{ api, getToken \} from '\.\/api'/);
  assert.match(source, /auth:\s*\{\s*token:\s*getToken\(\)\s*\}/s);
});
