const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(
  path.resolve(__dirname, '../src/app/dashboard/stock/page.tsx'),
  'utf8'
);

test('stock load always stops loading and provides an accessible retry after failures', () => {
  assert.match(page, /const \[loadErr, setLoadErr\] = useState\(''\)/);
  assert.match(page, /try \{[\s\S]*?await api\.(?:looseStock|jewelryStock)[\s\S]*?\} catch \(err\) \{[\s\S]*?setLoadErr\([\s\S]*?\} finally \{[\s\S]*?setLoading\(false\)/);
  assert.match(page, /role="alert"/);
  assert.match(page, /Retry/);
  assert.match(page, /onClick=\{load\}/);
});
