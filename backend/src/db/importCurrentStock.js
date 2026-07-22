// Imports the daily loose and jewelry files atomically. Run a dry run first:
//   npm run import:current-stock -- --loose "C:\path\loose.xlsx" --jewelry "C:\path\jewelry.xlsx"
// Then add --apply after checking the summary. This never accepts a partial
// file: each import must contain valid barcodes and all three office branches.
require('dotenv').config();
const fs = require('fs');
const XLSX = require('xlsx');
const pool = require('./pool');
const { parseSheet } = require('../utils/columnMapping');
const { normalizeStockStatus } = require('../services/stockStatus');
const { withTransaction } = require('./withRetry');

const args = process.argv.slice(2);
const valueFor = (name) => args[args.indexOf(name) + 1];
const loosePath = valueFor('--loose');
const jewelryPath = valueFor('--jewelry');
const apply = args.includes('--apply');
const expectedBranches = new Set(['NY', 'CH', 'LA']);
const branchMap = new Map([
  ['NY', 'NY'], ['NYC', 'NY'], ['NEW YORK', 'NY'], ['NEW YORK CITY', 'NY'],
  ['CH', 'CH'], ['CHI', 'CH'], ['CHICAGO', 'CH'],
  ['LA', 'LA'], ['LOS ANGELES', 'LA'], ['L.A.', 'LA'],
]);
const normalizeBranch = (value) => branchMap.get(String(value || '').trim().toUpperCase().replace(/\s+/g, ' '));
const numeric = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
};

function readFile(filePath, expectedFormat) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`File not found: ${filePath || '(missing path)'}`);
  const workbook = XLSX.readFile(filePath, { raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const { format, rows } = parseSheet(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }));
  if (format !== expectedFormat) throw new Error(`${filePath} was recognized as ${format}, expected ${expectedFormat}`);
  const grouped = new Map();
  const invalid = [];
  for (const row of rows) {
    const barcode = String(row.barcode || '').trim();
    const branch = normalizeBranch(row.branch);
    if (!barcode || !branch) { invalid.push(row); continue; }
    if (!grouped.has(branch)) grouped.set(branch, new Map());
    grouped.get(branch).set(barcode, { ...row, barcode, branch });
  }
  if (invalid.length) throw new Error(`${filePath} has ${invalid.length} row(s) missing a valid barcode or branch`);
  if ([...expectedBranches].some((branch) => !grouped.has(branch))) {
    throw new Error(`${filePath} must include NY, CH, and LA branches`);
  }
  return grouped;
}

const specs = {
  loose: {
    table: 'loose_diamonds',
    columns: ['barcode', 'branch', 'lab', 'certificate_no', 'shape', 'carat', 'color', 'clarity', 'cut', 'polish', 'symmetry', 'length_mm', 'width_mm', 'height_mm', 'lw_ratio', 'stock_status', 'cost'],
    values: (r, branch) => [r.barcode, branch, r.lab, r.certificate_no, r.shape, numeric(r.carat), r.color, r.clarity, r.cut, r.polish, r.symmetry, numeric(r.length_mm), numeric(r.width_mm), numeric(r.height_mm), numeric(r.lw_ratio), normalizeStockStatus(r.stock_status), numeric(r.cost)],
  },
  jewelry: {
    table: 'jewelry_pieces',
    columns: ['barcode', 'branch', 'img_link', 'video_link', 'category', 'item', 'ref_no', 'metal', 'metal_weight', 'gross_weight', 'diamond_cts', 'diamond_pcs', 'diamond_size', 'lab', 'cert_no', 'stock_status', 'amount'],
    values: (r, branch) => [r.barcode, branch, r.img_link, r.video_link, r.category, r.item, r.ref_no, r.metal, numeric(r.metal_weight), numeric(r.gross_weight), numeric(r.diamond_cts), numeric(r.diamond_pcs), r.diamond_size, r.lab, r.cert_no, normalizeStockStatus(r.stock_status), numeric(r.amount)],
  },
};

async function replace(client, format, grouped) {
  const spec = specs[format];
  const update = spec.columns.filter((column) => column !== 'barcode').map((column) => `${column} = EXCLUDED.${column}`).concat('updated_at = now()').join(', ');
  let count = 0;
  for (const [branch, rowsByBarcode] of grouped) {
    await client.query(`DELETE FROM ${spec.table} WHERE branch = $1`, [branch]);
    const rows = [...rowsByBarcode.values()];
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      const params = [];
      const groups = chunk.map((row, index) => {
        params.push(...spec.values(row, branch));
        const base = index * spec.columns.length;
        return `(${spec.columns.map((_, col) => `$${base + col + 1}`).join(', ')}, now())`;
      });
      await client.query(`INSERT INTO ${spec.table} (${spec.columns.join(', ')}, updated_at) VALUES ${groups.join(', ')} ON CONFLICT (barcode) DO UPDATE SET ${update}`, params);
      count += chunk.length;
    }
  }
  return count;
}

function summary(name, grouped) {
  const parts = [...grouped.entries()].map(([branch, rows]) => `${branch}: ${rows.size}`).join(', ');
  console.log(`${name}: ${parts} (${[...grouped.values()].reduce((total, rows) => total + rows.size, 0)} total)`);
}

async function main() {
  const loose = readFile(loosePath, 'loose');
  const jewelry = readFile(jewelryPath, 'jewelry');
  summary('Loose diamonds', loose); summary('Jewelry', jewelry);
  if (!apply) { console.log('Dry run only. Re-run with --apply to replace current stock.'); return; }
  const result = await withTransaction(pool, async (client) => ({ loose: await replace(client, 'loose', loose), jewelry: await replace(client, 'jewelry', jewelry) }));
  console.log(`Imported ${result.loose} loose diamonds and ${result.jewelry} jewelry pieces.`);
}
main().catch((err) => { console.error(`Stock import failed: ${err.message}`); process.exitCode = 1; }).finally(() => pool.end());
