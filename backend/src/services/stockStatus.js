function normalizeStockStatus(value) {
  const raw = String(value || 'Available').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!raw) return 'available';
  if (raw === 'available' || raw === 'in stock' || raw === 'instock') return 'available';
  if (raw === 'on memo' || raw === 'onmemo' || raw === 'memo' || raw === 'memo out') return 'on_memo';
  if (raw === 'on hold' || raw === 'onhold' || raw === 'hold' || raw === 'held') return 'on_hold';
  if (raw === 'in transit' || raw === 'intransit') return 'in_transit';
  return raw.replace(/\s+/g, '_');
}

function stockStatusLabel(status) {
  const normalized = normalizeStockStatus(status);
  if (normalized === 'available') return 'Available';
  if (normalized === 'on_memo') return 'On Memo';
  if (normalized === 'on_hold') return 'On Hold';
  if (normalized === 'in_transit') return 'In Transit';
  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Available / On Hold / On Memo / In Transit all come from the daily Excel
// snapshot and can go stale within a day (a hold is released, a memo comes
// back, a transit lands) well before the next import, so none of them alone
// blocks a request. A stone missing from the snapshot entirely
// (snapshot_active === false, checked by callers separately) still blocks —
// that's a different signal than its last-known status. Duplicate-request
// protection (a stone already held by another rep's active request) is
// enforced separately at request time regardless of status, so it still
// blocks two reps claiming the same stone.
function isRequestableStockStatus(status) {
  return ['available', 'on_hold', 'on_memo', 'in_transit'].includes(normalizeStockStatus(status));
}

module.exports = { normalizeStockStatus, stockStatusLabel, isRequestableStockStatus };
