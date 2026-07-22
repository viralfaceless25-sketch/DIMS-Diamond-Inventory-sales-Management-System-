const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Next produces a static export with stable directory URLs', () => {
  const config = read('next.config.mjs');
  assert.match(config, /output:\s*['"]export['"]/);
  assert.match(config, /trailingSlash:\s*true/);
});

test('rep history is query-based so no build-time rep list is required', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/app/dashboard/reps/[id]/page.tsx')), false);
  const page = read('src/app/dashboard/reps/page.tsx');
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(page, /useSearchParams/);
  assert.match(layout, /\/dashboard\/reps\?id=/);
});
