const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorizeLockedRequestStock,
  prepareReturnedReopen,
} = require('../src/services/requestStockService');
const { getHoldersMap } = require('../src/services/duplicateService');

const STONE = [{ barcode: 'LA-100', itemType: 'loose' }];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// This models only the database boundaries used below: a physical stock-row
// lock is held until commit/rollback, and active holders become visible only
// at commit. The production stock-lock and holder-query helpers remain real.
function createTransactionProtocolHarness() {
  let lockOwner = null;
  const lockWaiters = [];
  const blockedSignals = new Map();
  const activeHolderIds = new Set();

  function blockedSignal(name) {
    if (!blockedSignals.has(name)) blockedSignals.set(name, deferred());
    return blockedSignals.get(name);
  }

  async function acquireStockLock(name) {
    if (!lockOwner) {
      lockOwner = name;
      return;
    }
    const gate = deferred();
    lockWaiters.push({ name, gate });
    blockedSignal(name).resolve();
    await gate.promise;
  }

  function releaseStockLock(name) {
    assert.equal(lockOwner, name, `${name} must own the stock lock before release`);
    const next = lockWaiters.shift();
    if (!next) {
      lockOwner = null;
      return;
    }
    lockOwner = next.name;
    next.gate.resolve();
  }

  function client(name) {
    const stagedHolderIds = new Set();
    return {
      async query(sql) {
        if (sql.includes('FROM loose_diamonds')) {
          await acquireStockLock(name);
          return { rows: [{
            barcode: 'LA-100', branch: 'LA', stock_status: 'available',
            snapshot_active: true, item_type: 'loose',
          }] };
        }
        if (sql.includes('FROM stock_recheck_requests')) return { rows: [] };
        if (sql.includes('FROM request_stones rs')) {
          return { rows: [...activeHolderIds].map((requestId) => ({
            barcode: 'LA-100', request_id: requestId, sales_rep_id: requestId,
            rep_name: `Rep ${requestId}`, supply_branch: 'LA',
          })) };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      stageActiveHolder(requestId) {
        stagedHolderIds.add(requestId);
      },
      commit() {
        for (const requestId of stagedHolderIds) activeHolderIds.add(requestId);
        releaseStockLock(name);
      },
      rollback() {
        stagedHolderIds.clear();
        releaseStockLock(name);
      },
    };
  }

  return {
    client,
    activeHolderIds: () => [...activeHolderIds].sort((a, b) => a - b),
    lockOwner: () => lockOwner,
    waitForBlocked: (name) => blockedSignal(name).promise,
    waiterCount: () => lockWaiters.length,
  };
}

async function createRequest(client, requestId) {
  await authorizeLockedRequestStock(client, STONE, 8);
  const holders = await getHoldersMap('LA', client);
  if ((holders.get('LA-100') || []).length) {
    const error = new Error('Request blocked: LA-100 is already requested');
    error.status = 409;
    throw error;
  }
  client.stageActiveHolder(requestId);
}

async function reopenReturnedItem(client, requestId) {
  await prepareReturnedReopen(
    client,
    [{ barcode: 'LA-100', itemType: 'loose', returned: true }],
    'LA',
    requestId
  );
  client.stageActiveHolder(requestId);
}

test('reopen-first serializes creation until its active holder commits', async () => {
  const harness = createTransactionProtocolHarness();
  const reopen = harness.client('reopen');
  const create = harness.client('create');

  await reopenReturnedItem(reopen, 41);
  const creation = createRequest(create, 99).then(() => null, (error) => error);
  await harness.waitForBlocked('create');

  assert.equal(harness.lockOwner(), 'reopen');
  assert.deepEqual(harness.activeHolderIds(), []);
  reopen.commit();

  const error = await creation;
  assert.equal(error.status, 409);
  create.rollback();
  assert.deepEqual(harness.activeHolderIds(), [41]);
  assert.equal(harness.lockOwner(), null);
  assert.equal(harness.waiterCount(), 0);
});

test('creation-first serializes reopen until its new active holder commits', async () => {
  const harness = createTransactionProtocolHarness();
  const create = harness.client('create');
  const reopen = harness.client('reopen');

  await createRequest(create, 99);
  const reopening = reopenReturnedItem(reopen, 41).then(() => null, (error) => error);
  await harness.waitForBlocked('reopen');

  assert.equal(harness.lockOwner(), 'create');
  assert.deepEqual(harness.activeHolderIds(), []);
  create.commit();

  const error = await reopening;
  assert.equal(error.status, 409);
  reopen.rollback();
  assert.deepEqual(harness.activeHolderIds(), [99]);
  assert.equal(harness.lockOwner(), null);
  assert.equal(harness.waiterCount(), 0);
});
