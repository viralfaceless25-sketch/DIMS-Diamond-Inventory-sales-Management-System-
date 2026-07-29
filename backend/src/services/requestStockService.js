const {
  isRequestableStockStatus,
  normalizeStockStatus,
  stockStatusLabel,
} = require('./stockStatus');

function requestError(status, message, blocked) {
  const error = new Error(message);
  error.status = status;
  if (blocked) error.blocked = blocked;
  return error;
}

function normalizeRequestedStones(stones) {
  if (!Array.isArray(stones) || stones.length === 0) {
    throw requestError(400, 'A non-empty stones[] list is required');
  }
  if (stones.length > 50) {
    throw requestError(400, 'A request can contain a maximum of 50 items');
  }

  const normalized = [];
  const seen = new Set();
  for (const stone of stones) {
    const barcode = String(stone?.barcode || '').trim().toUpperCase();
    if (!barcode) continue;
    if (barcode.length > 64) {
      throw requestError(400, `Barcode ${barcode.slice(0, 16)}... exceeds 64 characters`);
    }
    const itemType = stone?.itemType === 'jewelry' ? 'jewelry' : 'loose';
    const key = `${itemType}:${barcode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ barcode, itemType });
  }

  if (normalized.length === 0) {
    throw requestError(400, 'At least one valid barcode is required');
  }
  return normalized;
}

async function lockStockTable(client, table, itemType, barcodes) {
  if (!barcodes.length) return [];
  const { rows } = await client.query(
    `SELECT barcode, branch, stock_status, '${itemType}' AS item_type
     FROM ${table}
     WHERE barcode = ANY($1)
     ORDER BY barcode FOR UPDATE`,
    [barcodes]
  );
  return rows;
}

async function loadLockedRequestStock(client, stones) {
  const looseBarcodes = stones
    .filter((stone) => stone.itemType === 'loose')
    .map((stone) => stone.barcode)
    .sort();
  const jewelryBarcodes = stones
    .filter((stone) => stone.itemType === 'jewelry')
    .map((stone) => stone.barcode)
    .sort();

  const rows = [
    ...await lockStockTable(client, 'loose_diamonds', 'loose', looseBarcodes),
    ...await lockStockTable(client, 'jewelry_pieces', 'jewelry', jewelryBarcodes),
  ];
  return new Map(rows.map((row) => [`${row.item_type}:${row.barcode}`, row]));
}

function validateRequestStock(stones, stockByKey) {
  const blocked = [];
  for (const stone of stones) {
    const stock = stockByKey.get(`${stone.itemType}:${stone.barcode}`);
    if (!stock) {
      blocked.push(`${stone.barcode} is not in stock`);
      continue;
    }
    const status = normalizeStockStatus(stock.stock_status);
    if (!isRequestableStockStatus(status)) {
      blocked.push(`${stone.barcode} is ${stockStatusLabel(status)}`);
    }
  }

  if (blocked.length) {
    const summary = `${blocked.slice(0, 5).join('; ')}${blocked.length > 5 ? `; +${blocked.length - 5} more` : ''}`;
    throw requestError(409, `Request blocked: ${summary}`, blocked);
  }
}

module.exports = {
  normalizeRequestedStones,
  loadLockedRequestStock,
  validateRequestStock,
};
