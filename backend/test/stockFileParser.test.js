const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { parseStockFile } = require('../src/services/stockFileParser');

async function withTempFile(name, contents, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-stock-test-'));
  const filePath = path.join(dir, name);
  try {
    await fs.writeFile(filePath, contents);
    return await run(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('CSV loose-stone stock parses in the background with statuses and branches intact', async () => {
  await withTempFile(
    'loose.csv',
    [
      'Barcode,Branch,Status,Carat,Shape',
      'NY-1,New York,Available,1.25,Round',
      'LA-2,Los Angeles,On Memo,2.5,Oval',
    ].join('\n'),
    async (filePath) => {
      const result = await parseStockFile(filePath, 'loose.csv');
      assert.equal(result.format, 'loose');
      assert.deepEqual(result.rows, [
        { barcode: 'NY-1', branch: 'New York', stock_status: 'Available', carat: '1.25', shape: 'Round' },
        { barcode: 'LA-2', branch: 'Los Angeles', stock_status: 'On Memo', carat: '2.5', shape: 'Oval' },
      ]);
    }
  );
});

test('XLSX jewelry stock parses without blocking the API event loop', async () => {
  const ExcelJS = require('exceljs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-stock-test-'));
  const filePath = path.join(dir, 'jewelry.xlsx');
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock');
    sheet.addRow(['Barcode', 'Branch', 'Status', 'Category', 'Metal', 'Amount']);
    sheet.addRow(['J-1', 'Chicago', 'On Hold', 'Ring', '18K WG', 2500]);
    await workbook.xlsx.writeFile(filePath);

    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
    }, 0);
    const result = await parseStockFile(filePath, 'jewelry.xlsx');
    clearTimeout(timer);

    assert.equal(timerFired, true, 'parsing should run outside the API event loop');
    assert.equal(result.format, 'jewelry');
    assert.deepEqual(result.rows, [{
      barcode: 'J-1',
      branch: 'Chicago',
      stock_status: 'On Hold',
      category: 'Ring',
      metal: '18K WG',
      amount: 2500,
    }]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('legacy XLS files are rejected safely instead of exhausting server memory', async () => {
  await withTempFile('legacy.xls', 'not-an-xls', async (filePath) => {
    await assert.rejects(
      () => parseStockFile(filePath, 'legacy.xls'),
      /save it as \.xlsx or \.csv/i
    );
  });
});

test('HTTP upload stores files on disk and never expands an XLSX buffer on the API thread', async () => {
  const route = await fs.readFile(path.resolve(__dirname, '../src/routes/stock.js'), 'utf8');
  assert.match(route, /multer\.diskStorage/);
  assert.match(route, /parseStockFile\(req\.file\.path/);
  assert.match(route, /fs\.unlink\(req\.file\.path\)/);
  assert.doesNotMatch(route, /XLSX\.read\(req\.file\.buffer/);
  assert.doesNotMatch(route, /multer\.memoryStorage/);
});
