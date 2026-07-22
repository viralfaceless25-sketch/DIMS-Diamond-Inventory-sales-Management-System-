function normalizeStockStatus(value) {
  const raw = String(value || 'Available').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!raw) return 'available';
  if (raw === 'available' || raw === 'in stock' || raw === 'instock') return 'available';
  if (raw === 'on memo' || raw === 'memo' || raw === 'memo out') return 'on_memo';
  if (raw === 'on hold' || raw === 'hold' || raw === 'held') return 'on_hold';
  return raw.replace(/\s+/g, '_');
}

function stockStatusLabel(status) {
  const normalized = normalizeStockStatus(status);
  if (normalized === 'available') return 'Available';
  if (normalized === 'on_memo') return 'On Memo';
  if (normalized === 'on_hold') return 'On Hold';
  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isRequestableStockStatus(status) {
  return normalizeStockStatus(status) === 'available';
}

module.exports = { normalizeStockStatus, stockStatusLabel, isRequestableStockStatus };
