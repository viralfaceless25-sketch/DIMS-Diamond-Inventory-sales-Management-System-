const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const ExcelJS = require('exceljs');
const unzipper = require('unzipper');
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
  // ExcelJS's streaming reader consumes ZIP entries in physical order.
  // Current Excel writers commonly place xl/workbook.xml last, and the
  // Parse/async-iterator bridge can intermittently omit that final metadata
  // entry on newer Node versions. Open the central directory first, then feed
  // the same low-memory ExcelJS parsers in their required dependency order.
  const archive = await unzipper.Open.file(filePath);
  const entries = new Map(
    archive.files
      .filter((entry) => entry.type === 'File')
      .map((entry) => [entry.path.replace(/\\/g, '/').replace(/^\/+/, ''), entry])
  );
  const workbookEntry = entries.get('xl/workbook.xml');
  const relationshipsEntry = entries.get('xl/_rels/workbook.xml.rels');
  const worksheetEntries = [...entries.entries()]
    .map(([entryPath, entry]) => {
      const match = entryPath.match(/^xl\/worksheets\/sheet(\d+)\.xml$/i);
      return match ? { entry, sheetNo: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.sheetNo - b.sheetNo);

  if (!workbookEntry || !relationshipsEntry || worksheetEntries.length === 0) {
    const error = new Error('The uploaded XLSX is missing required workbook or worksheet data');
    error.code = 'INVALID_STOCK_WORKBOOK';
    throw error;
  }

  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });

  await workbook._parseRels(relationshipsEntry.stream());
  await workbook._parseWorkbook(workbookEntry.stream());
  const sharedStringsEntry = entries.get('xl/sharedStrings.xml');
  if (sharedStringsEntry) {
    for await (const unused of workbook._parseSharedStrings(sharedStringsEntry.stream())) {
      void unused;
    }
  }

  const firstWorksheet = worksheetEntries[0];
  const worksheetEvents = [
    ...workbook._parseWorksheet(firstWorksheet.entry.stream(), firstWorksheet.sheetNo),
  ];
  const worksheet = worksheetEvents.find((event) => event.eventType === 'worksheet')?.value;
  if (!worksheet) {
    const error = new Error('The uploaded XLSX does not contain a readable worksheet');
    error.code = 'INVALID_STOCK_WORKBOOK';
    throw error;
  }
  for await (const row of worksheet) {
    yield row.values.slice(1);
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
