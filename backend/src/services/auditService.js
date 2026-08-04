const pool = require('../db/pool');

async function writeAudit({ actorId = null, action, targetType = null, targetId = null, ip = null, details = {} }, queryable = pool) {
  await queryable.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, ip_address, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [actorId, action, targetType, targetId == null ? null : String(targetId), ip, JSON.stringify(details)]
  );
}

module.exports = { writeAudit };
