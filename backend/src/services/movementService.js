const MOVEMENT_LABELS = Object.freeze({
  requested: 'Requested',
  erp_transfer_recorded: 'ERP branch transfer recorded',
  packed_at_source: 'Packed at source',
  branch_transfer_sent: 'Branch transfer sent',
  branch_transfer_received: 'Branch transfer received',
  ready_for_rep: 'Ready for sales rep',
  stone_confirmed: 'Stone confirmed',
  certificate_confirmed: 'Certificate confirmed',
  handed_to_rep: 'Handed to sales rep',
  shipped_to_customer: 'Shipped to customer',
  dropped_off_to_customer: 'Dropped off to customer',
  returned: 'Returned',
});

const TRANSFER_MOVEMENTS = Object.freeze({
  pack: 'packed_at_source',
  ship: 'branch_transfer_sent',
  receive: 'branch_transfer_received',
  ready: 'ready_for_rep',
  hand_to_rep: 'handed_to_rep',
  ship_customer: 'shipped_to_customer',
  dropoff_customer: 'dropped_off_to_customer',
});

const STONE_FIELD_MOVEMENTS = Object.freeze({
  stone_found: 'stone_confirmed',
  cert_found: 'certificate_confirmed',
  returned: 'returned',
});

function movementLabel(type) {
  return MOVEMENT_LABELS[type] || String(type || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function movementForTransferAction(action) {
  return TRANSFER_MOVEMENTS[action] || null;
}

function movementForStoneField(field) {
  return STONE_FIELD_MOVEMENTS[field] || null;
}

async function recordStoneMovement(queryable, {
  requestId,
  requestStoneId,
  movementType,
  fromBranch = null,
  toBranch = null,
  actorId = null,
  details = {},
}) {
  if (!movementType) return null;
  const { rows } = await queryable.query(
    `INSERT INTO stone_movements
       (request_id, request_stone_id, sales_rep_id, barcode, movement_type,
        from_branch, to_branch, actor_id, details)
     SELECT r.id, rs.id, r.sales_rep_id, rs.barcode, $3, $4, $5, $6, $7
     FROM request_stones rs
     JOIN requests r ON r.id = rs.request_id
     WHERE r.id = $1 AND rs.id = $2
     RETURNING id`,
    [requestId, requestStoneId, movementType, fromBranch, toBranch, actorId, details]
  );
  return rows[0]?.id || null;
}

async function recordRequestMovement(queryable, requestId, {
  movementType,
  fromBranch = null,
  toBranch = null,
  actorId = null,
  details = {},
}) {
  if (!movementType) return 0;
  const { rowCount } = await queryable.query(
    `INSERT INTO stone_movements
       (request_id, request_stone_id, sales_rep_id, barcode, movement_type,
        from_branch, to_branch, actor_id, details)
     SELECT r.id, rs.id, r.sales_rep_id, rs.barcode, $2, $3, $4, $5, $6
     FROM request_stones rs
     JOIN requests r ON r.id = rs.request_id
     WHERE r.id = $1`,
    [requestId, movementType, fromBranch, toBranch, actorId, details]
  );
  return rowCount || 0;
}

module.exports = {
  MOVEMENT_LABELS,
  movementLabel,
  movementForTransferAction,
  movementForStoneField,
  recordStoneMovement,
  recordRequestMovement,
};
