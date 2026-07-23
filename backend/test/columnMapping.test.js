const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheet, createRowMapper } = require('../src/utils/columnMapping');

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

test('streaming row mapper detects jewelry and maps one row at a time', () => {
  const mapper = createRowMapper(['Barcode', 'Branch', 'Status', 'Category', 'Metal', 'Amount']);
  assert.equal(mapper.format, 'jewelry');
  assert.deepEqual(
    mapper.map(['J-1', 'Chicago', 'In Transit', 'Ring', '18K WG', 2500]),
    {
      barcode: 'J-1',
      branch: 'Chicago',
      stock_status: 'In Transit',
      category: 'Ring',
      metal: '18K WG',
      amount: 2500,
    }
  );
});
