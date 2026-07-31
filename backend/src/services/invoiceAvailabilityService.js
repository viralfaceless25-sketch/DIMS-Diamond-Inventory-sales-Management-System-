const {
  isRequestableStockStatus,
  normalizeStockStatus,
  stockStatusLabel,
} = require('./stockStatus');

function mergeInvoiceWithInventory(parsedStones, inventoryRows) {
  const inventoryByBarcode = new Map(
    inventoryRows.map((row) => [row.barcode, row])
  );

  return parsedStones.map((parsed) => {
    const inventory = inventoryByBarcode.get(parsed.barcode);
    if (!inventory) {
      return {
        ...parsed,
        source: 'invoice',
        available: false,
        reason: 'not_in_stock',
        stockBranch: null,
        stock_status: null,
        availabilityLabel: 'Not in stock',
      };
    }

    const stockStatus = normalizeStockStatus(inventory.stock_status);
    const snapshotActive = inventory.snapshot_active !== false;
    const requestable = snapshotActive
      && isRequestableStockStatus(stockStatus);

    if (requestable) {
      const { cost, ...safeInventory } = inventory;
      if (safeInventory.carat != null) {
        safeInventory.carat = Number(safeInventory.carat);
      }
      return {
        ...safeInventory,
        stock_status: stockStatus,
        stockBranch: safeInventory.branch,
        source: 'inventory',
        available: true,
        // On Hold / On Memo / In Transit no longer block the request, but the
        // rep reviewing the extracted PDF should still see the real snapshot
        // status rather than a flattened "Available", same as the browse grid.
        availabilityLabel: stockStatusLabel(stockStatus),
      };
    }

    const reason = snapshotActive ? stockStatus : 'not_in_snapshot';
    return {
      ...parsed,
      item_type: inventory.item_type || parsed.item_type,
      source: 'inventory',
      available: false,
      reason,
      stockBranch: inventory.branch || null,
      branch: inventory.branch || null,
      stock_status: stockStatus,
      snapshot_active: snapshotActive,
      last_seen_at: inventory.last_seen_at || null,
      availabilityLabel: snapshotActive
        ? stockStatusLabel(stockStatus)
        : 'Not in latest ERP snapshot',
    };
  });
}

module.exports = { mergeInvoiceWithInventory };
