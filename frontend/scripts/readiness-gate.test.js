const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('root layout waits for the API before restoring authentication', () => {
  const layout = read('src/app/layout.tsx');
  assert.match(layout, /<ApiReadinessGate[\s\S]*<AuthProvider>/);
});

test('readiness gate explains cold starts and offers a manual retry', () => {
  const gate = read('src/components/ApiReadinessGate.tsx');
  assert.match(gate, /Waking up the inventory server/);
  assert.match(gate, />\s*Retry\s*</);
  assert.match(gate, /waitForApiReady/);
});

test('public download page never waits for the API', () => {
  const gate = read('src/components/ApiReadinessGate.tsx');
  assert.match(gate, /pathname\.startsWith\('\/download'\)/);
});

test('wake-up indicator uses a defined animation', () => {
  const gate = read('src/components/ApiReadinessGate.tsx');
  const css = read('src/app/globals.css');
  assert.match(gate, /animation: 'server-wake-spin/);
  assert.match(css, /@keyframes server-wake-spin/);
});
