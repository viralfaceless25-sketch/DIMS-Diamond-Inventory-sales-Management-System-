function applyResolutionChoice(stone, field, value, actorId, changedAt = new Date()) {
  if (!['stone_found', 'cert_found', 'not_found'].includes(field) || typeof value !== 'boolean') {
    throw new Error('Invalid resolution choice');
  }
  const next = {
    stone_found: Boolean(stone.stone_found),
    cert_found: Boolean(stone.cert_found),
    not_found: Boolean(stone.not_found),
    stone_found_at: stone.stone_found_at || null,
    cert_found_at: stone.cert_found_at || null,
    not_found_at: stone.not_found_at || null,
    not_found_by: stone.not_found_by || null,
  };

  if (field === 'not_found') {
    next.not_found = value;
    next.not_found_at = value ? changedAt : null;
    next.not_found_by = value ? actorId : null;
    if (value) {
      next.stone_found = false;
      next.cert_found = false;
      next.stone_found_at = null;
      next.cert_found_at = null;
    }
    return next;
  }

  next[field] = value;
  next[`${field}_at`] = value ? changedAt : null;
  if (value) {
    next.not_found = false;
    next.not_found_at = null;
    next.not_found_by = null;
  }
  return next;
}

async function recordFirstView(queryable, requestId, actorId) {
  const { rows } = await queryable.query(
    `UPDATE requests
     SET inventory_viewed_at = now(), inventory_viewed_by = $2
     WHERE id = $1 AND inventory_viewed_at IS NULL
       AND resolution_confirmed = false AND status <> 'cancelled'
     RETURNING inventory_viewed_at, inventory_viewed_by`,
    [requestId, actorId]
  );
  if (!rows[0]) return { firstView: false };
  return {
    inventoryViewedAt: rows[0].inventory_viewed_at,
    inventoryViewedBy: rows[0].inventory_viewed_by,
    firstView: true,
  };
}

async function requestingUserId(queryable, requestId) {
  const { rows } = await queryable.query(
    `SELECT COALESCE(r.requested_by, legacy_user.id) AS user_id
     FROM requests r
     LEFT JOIN LATERAL (
       SELECT u.id FROM users u
       WHERE u.sales_rep_id = r.sales_rep_id
         AND u.role = 'sales_rep' AND u.is_active = true
       ORDER BY u.id LIMIT 1
     ) legacy_user ON true
     WHERE r.id = $1`,
    [requestId]
  );
  return rows[0]?.user_id ? Number(rows[0].user_id) : null;
}

function buildViewedNotification(request) {
  return {
    eventId: `request-viewed:${request.id}`,
    kind: 'request-viewed',
    requestId: Number(request.id),
    fulfillmentBranch: request.fulfillmentBranch,
  };
}

function buildConfirmedNotification(request) {
  return {
    eventId: `request-confirmed:${request.id}`,
    kind: 'request-confirmed',
    requestId: Number(request.id),
    fulfillmentBranch: request.fulfillmentBranch,
    foundCount: Number(request.foundCount || 0),
    notFoundCount: Number(request.notFoundCount || 0),
  };
}

module.exports = {
  applyResolutionChoice,
  buildConfirmedNotification,
  buildViewedNotification,
  recordFirstView,
  requestingUserId,
};
