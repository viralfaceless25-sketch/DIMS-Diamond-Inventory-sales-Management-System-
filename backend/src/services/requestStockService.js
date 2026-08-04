const {
  isRequestableStockStatus,
  normalizeStockStatus,
  stockStatusLabel,
} = require('./stockStatus');
const {
  isAvailabilityAuthorizationUsable,
  loadLockedAvailabilityAuthorizations,
} = require('./stockRecheckService');
const { getHoldersMap } = require('./duplicateService');

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
    `SELECT barcode, branch, stock_status, snapshot_active, last_seen_at,
            snapshot_missing_since, '${itemType}' AS item_type
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

function validateRequestStock(stones, stockByKey, {
  authorizationsByKey = new Map(),
  salesRepId = null,
} = {}) {
  const blocked = [];
  const authorizationIds = [];
  for (const stone of stones) {
    const key = `${stone.itemType}:${stone.barcode}`;
    const stock = stockByKey.get(key);
    if (!stock) {
      blocked.push(`${stone.barcode} is not in stock`);
      continue;
    }
    const status = normalizeStockStatus(stock.stock_status);
    const normallyRequestable = stock.snapshot_active !== false
      && isRequestableStockStatus(status);
    if (normallyRequestable) continue;

    const authorization = authorizationsByKey.get(key);
    if (isAvailabilityAuthorizationUsable({
      authorization,
      stock,
      stone,
      salesRepId,
    })) {
      authorizationIds.push(authorization.id);
      continue;
    }
    if (stock.snapshot_active === false) {
      blocked.push(`${stone.barcode} is Not in latest ERP snapshot`);
    } else {
      blocked.push(`${stone.barcode} is ${stockStatusLabel(status)}`);
    }
  }

  if (blocked.length) {
    const summary = `${blocked.slice(0, 5).join('; ')}${blocked.length > 5 ? `; +${blocked.length - 5} more` : ''}`;
    throw requestError(409, `Request blocked: ${summary}`, blocked);
  }
  return authorizationIds;
}

async function authorizeLockedRequestStock(client, stones, salesRepId) {
  const stockByKey = await loadLockedRequestStock(client, stones);
  const authorizationsByKey = await loadLockedAvailabilityAuthorizations(
    client,
    salesRepId,
    stones
  );
  const authorizationIds = validateRequestStock(stones, stockByKey, {
    authorizationsByKey,
    salesRepId,
  });
  return { stockByKey, authorizationIds };
}

// A returned item can be made active again only after taking the same typed
// stock-row locks used by request creation. This makes the following holder
// lookup serial with a concurrent creation for the same physical item.
async function prepareReturnedReopen(client, requestStones, fulfillmentBranch, requestId) {
  const reopening = requestStones.filter((stone) => stone.returned);
  if (!reopening.length) return;

  const stockByKey = await loadLockedRequestStock(client, reopening);
  for (const stone of reopening) {
    if (!stockByKey.has(`${stone.itemType}:${stone.barcode}`)) {
      throw requestError(409, `Request blocked: ${stone.barcode} is no longer in stock`);
    }
  }

  const holdersMap = await getHoldersMap(fulfillmentBranch, client);
  const blocked = [];
  for (const stone of reopening) {
    const holders = (holdersMap.get(stone.barcode) || [])
      .filter((holder) => Number(holder.requestId) !== Number(requestId));
    if (holders.length) {
      const names = [...new Set(holders.map((holder) => holder.repName))].join(', ');
      blocked.push(`${stone.barcode} is already requested by ${names}`);
    }
  }
  if (blocked.length) {
    const summary = `${blocked.slice(0, 5).join('; ')}${blocked.length > 5 ? `; +${blocked.length - 5} more` : ''}`;
    throw requestError(409, `Request blocked: ${summary}`, blocked);
  }
}

module.exports = {
  authorizeLockedRequestStock,
  normalizeRequestedStones,
  loadLockedRequestStock,
  validateRequestStock,
  prepareReturnedReopen,
};
