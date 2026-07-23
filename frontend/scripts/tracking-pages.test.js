const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('inventory tracking renders movement-history controls', () => {
  const page = read('src/app/dashboard/tracking/page.tsx');
  assert.match(page, /Stone movement history/);
  assert.match(page, /MOVEMENT/);
  assert.match(page, /FROM/);
  assert.match(page, /TO/);
  assert.match(page, /CERTIFICATE/);
});

test('sales reps have a scoped stone-tracking page', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/app/rep/tracking/page.tsx')), true);
  assert.match(read('src/app/rep/layout.tsx'), /\/rep\/tracking/);
  assert.match(read('src/app/rep/tracking/page.tsx'), /My stone tracking/);
});
