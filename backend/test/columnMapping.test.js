const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheet } = require('../src/utils/columnMapping');

test('loose stock measurements map from the daily client spreadsheet', () => {
  const { format, rows } = parseSheet([
    ['Barcode', 'Branch', 'Length MM', 'Width MM', 'Height MM', 'L/W Ratio'],
    ['1509620-132', 'New York', 10.81, 7.55, 4.9, 1.43],
  ]);

  assert.equal(format, 'loose');
  assert.deepEqual(rows[0], {
    barcode: '1509620-132',
    branch: 'New York',
    length_mm: 10.81,
    width_mm: 7.55,
    height_mm: 4.9,
    lw_ratio: 1.43,
  });
});
