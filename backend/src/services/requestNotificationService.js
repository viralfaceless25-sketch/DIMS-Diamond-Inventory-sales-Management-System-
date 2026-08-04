function userRoom(userId) {
  const normalized = Number(userId);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? `user:${normalized}`
    : null;
}

function inventoryRoom(branch) {
  const normalized = String(branch || '').trim().toUpperCase();
  return /^[A-Z]{2,4}$/.test(normalized) ? `inventory:${normalized}` : null;
}

function buildRequestCreatedNotification(request, stones) {
  const previewBarcodes = stones.slice(0, 3).map((stone) => stone.barcode);
  return {
    eventId: `request-created:${request.id}`,
    kind: 'request-created',
    requestId: Number(request.id),
    repName: request.repName,
    repBranch: request.repBranch,
    requestType: request.requestType,
    requestScope: request.requestScope,
    fulfillmentBranch: request.fulfillmentBranch,
    itemCount: stones.length,
    previewBarcodes,
    remainingCount: Math.max(0, stones.length - previewBarcodes.length),
  };
}

module.exports = {
  buildRequestCreatedNotification,
  inventoryRoom,
  userRoom,
};
