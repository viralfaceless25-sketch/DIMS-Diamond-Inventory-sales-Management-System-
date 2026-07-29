const ExcelJS = require('exceljs');
const {
  BRANCH_TIME_ZONES,
  VALID_BRANCHES,
} = require('./receiptService');

function receiptExportFilename(branch, date) {
  const normalizedBranch = String(branch || '').toUpperCase();
  if (!VALID_BRANCHES.has(normalizedBranch)) throw new Error('A valid receiving branch is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('A valid receipt date is required');
  return `Received-Shipments-${normalizedBranch}-${date}.xlsx`;
}

function formatReceiptTime(value, branch) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BRANCH_TIME_ZONES[branch],
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant);
}

function buildReceiptWorkbook(rows, { branch, date }) {
  const normalizedBranch = String(branch || '').toUpperCase();
  receiptExportFilename(normalizedBranch, date);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Maitri Diamond Inventory';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Received from Branch', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'Barcode', key: 'barcode', width: 18 },
    { header: 'Stone', key: 'stone', width: 10 },
    { header: 'Cert', key: 'cert', width: 10 },
    { header: 'Location', key: 'location', width: 12 },
    { header: 'Time', key: 'time', width: 14 },
    { header: 'Request #', key: 'request', width: 12 },
    { header: 'Sales Rep', key: 'rep', width: 20 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Received By', key: 'receivedBy', width: 28 },
  ];
  sheet.autoFilter = { from: 'A1', to: 'I1' };
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };

  for (const row of rows) {
    sheet.addRow({
      barcode: row.barcode,
      stone: row.stoneReceived ? 'y' : 'n',
      cert: row.certReceived ? 'y' : 'n',
      location: row.sourceBranch,
      time: formatReceiptTime(row.receivedAt, normalizedBranch),
      request: row.requestId || '',
      rep: row.repName || '',
      status: row.status,
      receivedBy: row.receivedByEmail,
    });
  }
  return workbook;
}

module.exports = {
  buildReceiptWorkbook,
  receiptExportFilename,
};
