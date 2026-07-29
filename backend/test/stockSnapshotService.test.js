const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  archiveBranchSnapshot,
  buildTrackingSnapshotPresentation,
  deriveSnapshotReconciliation,
} = require('../src/services/stockSnapshotService');

test('branch replacement archives missing rows instead of deleting them', async () => {
  const calls = [];
  const count = await archiveBranchSnapshot({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 2 };
    },
  }, 'loose_diamonds', 'LA');

  assert.equal(count, 2);
  assert.match(calls[0].sql, /UPDATE loose_diamonds/);
  assert.match(calls[0].sql, /snapshot_active = false/);
  assert.doesNotMatch(calls[0].sql, /DELETE/);
  assert.deepEqual(calls[0].params, ['LA']);
});

test('snapshot archiving rejects dynamic table names', async () => {
  await assert.rejects(
    () => archiveBranchSnapshot({ query: async () => ({}) }, 'users; DROP TABLE users', 'LA'),
    /Unsupported stock table/
  );
});

test('a missing snapshot does not invent an ERP in-transit event', () => {
  assert.deepEqual(deriveSnapshotReconciliation({
    request: { crossBranch: true, erpTransferIssuedAt: null },
    stock: { snapshotActive: false },
  }), {
    state: 'missing',
    label: 'Not in latest ERP snapshot',
  });
});

test('a snapshot older than a manual ERP event is stale, not contradictory', () => {
  assert.deepEqual(deriveSnapshotReconciliation({
    request: {
      crossBranch: true,
      fulfillmentBranch: 'LA',
      deliveryBranch: 'NY',
      erpTransferIssuedAt: '2026-07-29T15:00:00.000Z',
      erpTransferReceivedAt: null,
    },
    stock: {
      snapshotActive: true,
      branch: 'LA',
      stockStatus: 'available',
      lastSeenAt: '2026-07-29T08:00:00.000Z',
    },
  }), {
    state: 'stale',
    label: 'Latest ERP snapshot predates the confirmed ERP action',
  });
});

test('a newer destination snapshot reconciles ERP BT receipt', () => {
  assert.deepEqual(deriveSnapshotReconciliation({
    request: {
      crossBranch: true,
      fulfillmentBranch: 'LA',
      deliveryBranch: 'NY',
      erpTransferIssuedAt: '2026-07-29T12:00:00.000Z',
      erpTransferReceivedAt: '2026-07-29T13:00:00.000Z',
    },
    stock: {
      snapshotActive: true,
      branch: 'NY',
      stockStatus: 'available',
      lastSeenAt: '2026-07-30T08:00:00.000Z',
    },
  }), {
    state: 'reconciled',
    label: 'Latest ERP snapshot agrees with the confirmed ERP movement',
  });
});

test('a newer contradictory snapshot is flagged for review', () => {
  assert.deepEqual(deriveSnapshotReconciliation({
    request: {
      crossBranch: true,
      fulfillmentBranch: 'LA',
      deliveryBranch: 'NY',
      erpTransferIssuedAt: '2026-07-29T12:00:00.000Z',
      erpTransferReceivedAt: '2026-07-29T13:00:00.000Z',
    },
    stock: {
      snapshotActive: true,
      branch: 'LA',
      stockStatus: 'available',
      lastSeenAt: '2026-07-30T08:00:00.000Z',
    },
  }), {
    state: 'mismatch',
    label: 'Latest ERP snapshot needs inventory review',
  });
});

test('tracking never presents an inactive or missing snapshot as available', () => {
  assert.deepEqual(buildTrackingSnapshotPresentation({
    request: {
      crossBranch: true,
      fulfillmentBranch: 'LA',
      deliveryBranch: 'NY',
      erpTransferIssuedAt: null,
      erpTransferReceivedAt: null,
    },
    stock: {
      snapshotActive: false,
      branch: 'LA',
      stockStatus: null,
      lastSeenAt: '2026-07-29T08:00:00.000Z',
      snapshotMissingSince: '2026-07-30T08:00:00.000Z',
    },
  }), {
    currentStockStatus: null,
    currentStockStatusLabel: 'Not in latest ERP snapshot',
    snapshot: {
      active: false,
      branch: 'LA',
      stockStatus: null,
      lastSeenAt: '2026-07-29T08:00:00.000Z',
      missingSince: '2026-07-30T08:00:00.000Z',
    },
    snapshotReconciliation: {
      state: 'missing',
      label: 'Not in latest ERP snapshot',
    },
  });
});

test('tracking normalizes and labels an active snapshot status', () => {
  assert.deepEqual(buildTrackingSnapshotPresentation({
    request: {
      crossBranch: false,
      fulfillmentBranch: 'NY',
      deliveryBranch: 'NY',
      erpTransferIssuedAt: null,
      erpTransferReceivedAt: null,
    },
    stock: {
      snapshotActive: true,
      branch: 'NY',
      stockStatus: 'On Hold',
      lastSeenAt: '2026-07-29T08:00:00.000Z',
      snapshotMissingSince: null,
    },
  }), {
    currentStockStatus: 'on_hold',
    currentStockStatusLabel: 'On Hold',
    snapshot: {
      active: true,
      branch: 'NY',
      stockStatus: 'on_hold',
      lastSeenAt: '2026-07-29T08:00:00.000Z',
      missingSince: null,
    },
    snapshotReconciliation: {
      state: 'current',
      label: 'Latest ERP snapshot',
    },
  });
});

test('the upload route archives and reactivates snapshots without branch deletes', async () => {
  const source = await fs.readFile(
    path.resolve(__dirname, '../src/routes/stock.js'),
    'utf8'
  );

  assert.match(source, /archiveBranchSnapshot\(client, table, branch\)/);
  assert.match(source, /snapshot_active=true/);
  assert.match(source, /last_seen_at=now\(\)/);
  assert.match(source, /snapshot_missing_since=NULL/);
  assert.doesNotMatch(source, /DELETE FROM \$\{table\} WHERE branch/);
});

test('request details expose snapshot facts and reconciliation separately', async () => {
  const source = await fs.readFile(
    path.resolve(__dirname, '../src/routes/requests.js'),
    'utf8'
  );

  assert.match(source, /snapshot_active/);
  assert.match(source, /last_seen_at/);
  assert.match(source, /snapshot_missing_since/);
  assert.match(source, /deriveSnapshotReconciliation/);
  assert.match(source, /snapshotReconciliation/);
});
