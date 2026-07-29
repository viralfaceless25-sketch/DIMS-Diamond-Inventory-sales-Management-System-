const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  buildReceiptWorkbook,
  receiptExportFilename,
} = require('../src/services/receiptExportService');

test('daily receipt export produces the familiar sheet plus request ownership', async () => {
  const workbook = buildReceiptWorkbook([{
    barcode: '267157-00',
    stoneReceived: true,
    certReceived: false,
    sourceBranch: 'CH',
    receivedAt: '2026-07-29T14:15:00.000Z',
    requestId: 81,
    repName: 'Parthik',
    status: 'Partial arrival',
    receivedByEmail: 'stockny@maitri.nyc',
  }], { branch: 'NY', date: '2026-07-29' });
  const buffer = await workbook.xlsx.writeBuffer();
  const parsed = new ExcelJS.Workbook();
  await parsed.xlsx.load(buffer);
  const sheet = parsed.getWorksheet('Received from Branch');

  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    'Barcode', 'Stone', 'Cert', 'Location', 'Time',
    'Request #', 'Sales Rep', 'Status', 'Received By',
  ]);
  assert.deepEqual(sheet.getRow(2).values.slice(1), [
    '267157-00', 'y', 'n', 'CH', '10:15 AM',
    81, 'Parthik', 'Partial arrival', 'stockny@maitri.nyc',
  ]);
  assert.equal(receiptExportFilename('NY', '2026-07-29'), 'Received-Shipments-NY-2026-07-29.xlsx');
});
