const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertStockRecheckVerification,
  buildRequestAvailabilityVerification,
  buildStockRecheckResolution,
  consumeAvailabilityAuthorizations,
  createOrReuseStockRecheck,
  isAvailabilityAuthorizationUsable,
  loadLockedAvailabilityAuthorizations,
  normalizeStockRecheckInput,
  resolveStockRecheck,
} = require('../src/services/stockRecheckService');

const stone = { barcode: 'LA-100', itemType: 'loose' };
const stock = {
  barcode: 'LA-100',
  item_type: 'loose',
  branch: 'LA',
  stock_status: 'on_hold',
  snapshot_active: true,
  last_seen_at: '2026-07-29T08:00:00.000Z',
};
const authorization = {
  id: 91,
  sales_rep_id: 7,
  barcode: 'LA-100',
  item_type: 'loose',
  home_branch: 'LA',
  state: 'verified_available',
  verified_status: 'available',
  verified_at: '2026-07-29T11:00:00.000Z',
  consumed_at: null,
};

test('only inventory assigned to the stored home branch can verify a recheck', () => {
  assert.doesNotThrow(() => assertStockRecheckVerification({
    recheck: { home_branch: 'LA', state: 'pending' },
    actorRole: 'inventory',
    actorBranch: 'LA',
  }));
  assert.throws(() => assertStockRecheckVerification({
    recheck: { home_branch: 'LA', state: 'pending' },
    actorRole: 'sales_rep',
    actorBranch: 'LA',
  }), /inventory access/);
  assert.throws(() => assertStockRecheckVerification({
    recheck: { home_branch: 'LA', state: 'pending' },
    actorRole: 'inventory',
    actorBranch: 'NY',
  }), /Only LA inventory/);
});

test('stock recheck input accepts only one valid item and bounded note text', () => {
  assert.deepEqual(normalizeStockRecheckInput({
    barcode: ' la-100 ',
    itemType: 'loose',
  }), {
    barcode: 'LA-100',
    itemType: 'loose',
  });
  assert.throws(
    () => normalizeStockRecheckInput({ barcode: 'X'.repeat(65), itemType: 'loose' }),
    /64 characters/
  );
  assert.throws(
    () => normalizeStockRecheckInput({ barcode: 'J-1', itemType: 'watch' }),
    /loose or jewelry/
  );

  assert.deepEqual(buildStockRecheckResolution({
    decision: 'available',
    note: ' Released in ERP ',
  }), {
    state: 'verified_available',
    verifiedStatus: 'available',
    note: 'Released in ERP',
  });
  assert.deepEqual(buildStockRecheckResolution({
    decision: 'unavailable',
    liveStatus: 'On Memo',
  }), {
    state: 'verified_unavailable',
    verifiedStatus: 'on_memo',
    note: null,
  });
  assert.throws(
    () => buildStockRecheckResolution({
      decision: 'unavailable',
      liveStatus: 'available',
    }),
    /unavailable status/
  );
  assert.throws(
    () => buildStockRecheckResolution({
      decision: 'available',
      note: 'N'.repeat(501),
    }),
    /500 characters/
  );
});

test('a verified availability authorization is exact, newer, and one-time', () => {
  assert.equal(isAvailabilityAuthorizationUsable({
    authorization,
    stock,
    stone,
    salesRepId: 7,
  }), true);
  assert.equal(isAvailabilityAuthorizationUsable({
    authorization: { ...authorization, sales_rep_id: 8 },
    stock,
    stone,
    salesRepId: 7,
  }), false);
  assert.equal(isAvailabilityAuthorizationUsable({
    authorization: { ...authorization, consumed_at: '2026-07-29T11:05:00.000Z' },
    stock,
    stone,
    salesRepId: 7,
  }), false);
  assert.equal(isAvailabilityAuthorizationUsable({
    authorization: { ...authorization, verified_at: '2026-07-29T07:59:59.000Z' },
    stock,
    stone,
    salesRepId: 7,
  }), false);
  assert.equal(isAvailabilityAuthorizationUsable({
    authorization: { ...authorization, home_branch: 'NY' },
    stock,
    stone,
    salesRepId: 7,
  }), false);
});

test('availability authorizations are locked in deterministic order', async () => {
  const calls = [];
  const rows = [
    authorization,
    { ...authorization, id: 92, barcode: 'J-2', item_type: 'jewelry' },
  ];
  const result = await loadLockedAvailabilityAuthorizations({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  }, 7, [
    { barcode: 'J-2', itemType: 'jewelry' },
    stone,
  ]);

  assert.match(calls[0].sql, /state = 'verified_available'/);
  assert.match(calls[0].sql, /consumed_at IS NULL/);
  assert.match(calls[0].sql, /ORDER BY item_type, barcode, verified_at DESC, id DESC FOR UPDATE/);
  assert.deepEqual(calls[0].params, [7, ['J-2', 'LA-100']]);
  assert.equal(result.get('loose:LA-100').id, 91);
  assert.equal(result.get('jewelry:J-2').id, 92);
});

test('authorization consumption is guarded against concurrent reuse', async () => {
  const calls = [];
  await consumeAvailabilityAuthorizations({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 2 };
    },
  }, [91, 92], 123);

  assert.match(calls[0].sql, /state = 'verified_available'/);
  assert.match(calls[0].sql, /consumed_at IS NULL/);
  assert.match(calls[0].sql, /state = 'consumed'/);
  assert.deepEqual(calls[0].params, [[91, 92], 123]);

  await assert.rejects(
    () => consumeAvailabilityAuthorizations({
      query: async () => ({ rowCount: 1 }),
    }, [91, 92], 124),
    /no longer available/
  );
});

test('creating a recheck derives the home branch and snapshot facts from locked stock', async () => {
  const calls = [];
  const created = {
    id: 101,
    sales_rep_id: 7,
    barcode: 'LA-100',
    item_type: 'loose',
    home_branch: 'LA',
    snapshot_status: 'on_hold',
    snapshot_active: true,
    snapshot_last_seen_at: '2026-07-29T08:00:00.000Z',
    state: 'pending',
  };
  const result = await createOrReuseStockRecheck({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM loose_diamonds')) return { rows: [stock] };
      if (sql.includes('FROM stock_recheck_requests')) return { rows: [] };
      if (sql.includes('INSERT INTO stock_recheck_requests')) return { rows: [created] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }, {
    salesRepId: 7,
    barcode: 'LA-100',
    itemType: 'loose',
  });

  assert.match(calls[0].sql, /FROM loose_diamonds/);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[2].params, [
    7,
    'LA-100',
    'loose',
    'LA',
    'on_hold',
    true,
    '2026-07-29T08:00:00.000Z',
  ]);
  assert.equal(result.reused, false);
  assert.equal(result.recheck.home_branch, 'LA');
});

test('resolving a recheck updates only the authorization, never snapshot stock', async () => {
  const calls = [];
  const pending = {
    id: 101,
    sales_rep_id: 7,
    barcode: 'LA-100',
    item_type: 'loose',
    home_branch: 'LA',
    state: 'pending',
  };
  const result = await resolveStockRecheck({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM stock_recheck_requests') && sql.includes('FOR UPDATE')) {
        return { rows: [pending] };
      }
      if (sql.includes('FROM stock_recheck_requests')) return { rows: [pending] };
      if (sql.includes('FROM loose_diamonds')) return { rows: [stock] };
      if (sql.includes('UPDATE stock_recheck_requests')) {
        return { rows: [{ ...pending, state: 'verified_available', verified_status: 'available' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }, {
    recheckId: 101,
    actorRole: 'inventory',
    actorBranch: 'LA',
    actorId: 22,
    resolution: {
      state: 'verified_available',
      verifiedStatus: 'available',
      note: 'Released in ERP',
    },
  });

  assert.equal(calls.some((call) => /UPDATE loose_diamonds/.test(call.sql)), false);
  assert.deepEqual(calls.at(-1).params, [
    101,
    'verified_available',
    'available',
    'Released in ERP',
    22,
  ]);
  assert.equal(result.state, 'verified_available');
});

test('request tracking preserves the consumed live ERP verification facts', () => {
  assert.equal(buildRequestAvailabilityVerification({}), null);
  assert.deepEqual(buildRequestAvailabilityVerification({
    live_recheck_id: 101,
    live_recheck_snapshot_status: 'on_hold',
    live_recheck_snapshot_active: true,
    live_recheck_snapshot_last_seen_at: '2026-07-29T08:00:00.000Z',
    live_recheck_verified_at: '2026-07-29T11:00:00.000Z',
    live_recheck_verified_by: 22,
    live_recheck_verifier_email: 'stockla@maitri.nyc',
  }), {
    id: 101,
    snapshotStatus: 'on_hold',
    snapshotActive: true,
    snapshotLastSeenAt: '2026-07-29T08:00:00.000Z',
    verifiedStatus: 'available',
    verifiedAt: '2026-07-29T11:00:00.000Z',
    verifiedBy: 22,
    verifierEmail: 'stockla@maitri.nyc',
  });
});
