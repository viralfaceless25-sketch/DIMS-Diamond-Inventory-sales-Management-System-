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
  assert.match(config, /outputFileTracingRoot:\s*process\.cwd\(\)/);
});

test('rep history is query-based so no build-time rep list is required', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/app/dashboard/reps/[id]/page.tsx')), false);
  const page = read('src/app/dashboard/reps/page.tsx');
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(page, /useSearchParams/);
  assert.match(layout, /\/dashboard\/reps\?id=/);
});

test('public download page exposes versioned Windows release details', () => {
  const page = read('src/app/download/page.tsx');
  assert.match(page, /release\.downloadUrl/);
  assert.match(page, /Windows 10 and Windows 11/);
  assert.match(page, /Windows protected your PC/);
  assert.match(page, /SHA-256/);
  assert.equal(fs.existsSync(path.join(root, 'src/release.json')), true);
});
