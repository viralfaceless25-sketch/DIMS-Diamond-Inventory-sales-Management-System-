const { writeAudit } = require('./auditService');

// Explicit delete order is child-before-parent for the request workflow.
// Receipt and recheck histories must be removed before requests, because their
// request links otherwise become null while their test records remain. The two
// document tables are intentionally left to their ON DELETE CASCADE links from
// requests. Account, branch, and prior audit data are intentionally preserved.
const TEST_DATA_CLEANUP_TABLES = [
  { table: 'shipment_receipts', countKey: 'shipmentReceiptsToDelete' },
  { table: 'stock_recheck_requests', countKey: 'stockRechecksToDelete' },
  { table: 'stone_movements', countKey: 'stoneMovementsToDelete' },
  { table: 'request_stones', countKey: 'requestStonesToDelete' },
  { table: 'requests', countKey: 'requestsToDelete' },
  { table: 'loose_diamonds', countKey: 'looseDiamondsToDelete' },
  { table: 'jewelry_pieces', countKey: 'jewelryPiecesToDelete' },
];

const PRESERVED_TEST_DATA_TABLES = [
  'users',
  'sales_reps',
  'branches',
  'audit_log',
  'request_paperwork_files (deleted by requests cascade)',
  'request_shipping_labels (deleted by requests cascade)',
];

async function countTestData(client) {
  const byTable = new Map();
  for (const { table } of TEST_DATA_CLEANUP_TABLES) {
    const { rows } = await client.query(`SELECT count(*) FROM ${table}`);
    byTable.set(table, Number(rows[0].count));
  }
  const [users, salesReps] = await Promise.all([
    client.query('SELECT count(*) FROM users'),
    client.query('SELECT count(*) FROM sales_reps'),
  ]);
  return {
    requestsToDelete: byTable.get('requests'),
    requestStonesToDelete: byTable.get('request_stones'),
    stoneMovementsToDelete: byTable.get('stone_movements'),
    shipmentReceiptsToDelete: byTable.get('shipment_receipts'),
    stockRechecksToDelete: byTable.get('stock_recheck_requests'),
    looseDiamondsToDelete: byTable.get('loose_diamonds'),
    jewelryPiecesToDelete: byTable.get('jewelry_pieces'),
    usersKept: Number(users.rows[0].count),
    salesRepsKept: Number(salesReps.rows[0].count),
  };
}

async function clearTestData(client, { dryRun, actorId, ip }) {
  const counts = await countTestData(client);
  if (dryRun) return counts;

  for (const { table } of TEST_DATA_CLEANUP_TABLES) {
    await client.query(`DELETE FROM ${table}`);
  }
  await writeAudit({
    actorId,
    action: 'admin.clear_test_data',
    targetType: 'system',
    ip,
    details: counts,
  }, client);
  return counts;
}

module.exports = {
  TEST_DATA_CLEANUP_TABLES,
  PRESERVED_TEST_DATA_TABLES,
  countTestData,
  clearTestData,
};
