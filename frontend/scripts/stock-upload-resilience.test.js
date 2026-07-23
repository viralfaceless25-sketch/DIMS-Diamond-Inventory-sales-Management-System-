const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(
  path.resolve(__dirname, '../src/app/dashboard/stock/page.tsx'),
  'utf8'
);

test('stock upload explains background processing for both inventory formats', () => {
  assert.match(page, /Processing stock file/);
  assert.match(page, /loose stones and jewelry/i);
  assert.match(page, /\.xlsx or \.csv/);
});
