const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const ExcelJS = require('exceljs');
const { parse } = require('@fast-csv/parse');
const { createRowMapper } = require('../utils/columnMapping');

function scalarCellValue(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if (Object.prototype.hasOwnProperty.call(value, 'result')) return scalarCellValue(value.result);
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
  if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text;
  if (Object.prototype.hasOwnProperty.call(value, 'hyperlink')) return value.text || value.hyperlink;
  return String(value);
}

function hasCells(row) {
  return row.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== '');
}

function validateMapper(mapper) {
  if (!mapper.fields.includes('barcode') || !mapper.fields.includes('branch')) {
    const error = new Error('The stock sheet must include recognizable Barcode and Branch columns');
    error.code = 'INVALID_STOCK_HEADERS';
    throw error;
  }
}

async function collectRows(rowIterator) {
  let mapper = null;
  const rows = [];

  for await (const rawRow of rowIterator) {
    const row = Array.from(rawRow, scalarCellValue);
    if (!hasCells(row)) continue;
    if (!mapper) {
      mapper = createRowMapper(row);
      validateMapper(mapper);
      continue;
    }
    rows.push(mapper.map(row));
  }

  return { format: mapper?.format || null, rows };
}

async function* xlsxRows(filePath) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });

  for await (const worksheet of workbook) {
    for await (const row of worksheet) {
      yield row.values.slice(1);
    }
    break;
  }
}

async function* csvRows(filePath) {
  const parser = fs.createReadStream(filePath).pipe(parse({
    headers: false,
    ignoreEmpty: true,
    trim: false,
  }));
  for await (const row of parser) yield row;
}

async function parseFile(filePath, originalName) {
  const extension = path.extname(String(originalName || filePath)).toLowerCase();
  if (extension === '.xls') {
    throw new Error('Legacy .xls files are not safe for online import; save it as .xlsx or .csv and upload again');
  }
  if (extension === '.csv') return collectRows(csvRows(filePath));
  if (extension === '.xlsx') return collectRows(xlsxRows(filePath));
  throw new Error('Only .xlsx or .csv stock files are accepted');
}

parseFile(workerData.filePath, workerData.originalName)
  .then((result) => parentPort.postMessage({ ok: true, result }))
  .catch((error) => parentPort.postMessage({
    ok: false,
    error: error.message || 'Stock file could not be parsed',
    code: error.code || 'STOCK_PARSE_FAILED',
  }));
