const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertHandoffAllowed,
  assertReceiptCorrectionAllowed,
} = require('../src/services/receiptService');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// A deterministic model of the production lock protocol. Correction first
// locks its shipment_receipts row to discover the matched request, then locks
// that shared request row. Handoff locks only the request row; it reads receipt
// rollup rows without FOR UPDATE. Therefore correction can wait on handoff's
// request lock while holding its receipt lock, but handoff never waits for that
// receipt lock: there is no lock cycle. Once the waiter gets the request lock,
// it sees the first transaction's committed state.
function createReceiptHandoffProtocol() {
  let receiptLockOwner = null;
  let lockOwner = null;
  const waiters = [];
  const blocked = new Map();
  const state = { transferStatus: 'ready_for_rep', complete: true };
  const writes = { correction: 0, handoff: 0 };

  function blockedSignal(name) {
    if (!blocked.has(name)) blocked.set(name, deferred());
    return blocked.get(name);
  }

  function lockReceipt(name) {
    assert.equal(receiptLockOwner, null, 'only one correction can own its receipt row');
    receiptLockOwner = name;
  }

  function unlockReceipt(name) {
    assert.equal(receiptLockOwner, name, `${name} must own the receipt lock`);
    receiptLockOwner = null;
  }

  async function lock(name) {
    if (!lockOwner) {
      lockOwner = name;
      return;
    }
    const gate = deferred();
    waiters.push({ name, gate });
    blockedSignal(name).resolve();
    await gate.promise;
  }

  function unlock(name) {
    assert.equal(lockOwner, name, `${name} must own the request lock`);
    const next = waiters.shift();
    if (!next) {
      lockOwner = null;
      return;
    }
    lockOwner = next.name;
    next.gate.resolve();
  }

  return {
    async correct() {
      lockReceipt('correction');
      await lock('correction');
      try {
        assertReceiptCorrectionAllowed({ transfer_status: state.transferStatus });
        return {
          commit() {
            state.complete = false;
            writes.correction += 1;
            unlock('correction');
            unlockReceipt('correction');
          },
          rollback() {
            unlock('correction');
            unlockReceipt('correction');
          },
        };
      } catch (error) {
        unlock('correction');
        unlockReceipt('correction');
        throw error;
      }
    },
    async handoff() {
      await lock('handoff');
      try {
        assertHandoffAllowed({
          request: {
            delivery_route: 'internal_transfer',
            destination_branch: 'NY',
            transfer_status: state.transferStatus,
            status: 'half_fulfilled',
          },
          receivingBranch: 'NY',
          rollup: { complete: state.complete },
        });
        return {
          commit() {
            state.transferStatus = 'handed_to_rep';
            writes.handoff += 1;
            unlock('handoff');
          },
          rollback() { unlock('handoff'); },
        };
      } catch (error) {
        unlock('handoff');
        throw error;
      }
    },
    state: () => ({ ...state }),
    writes: () => ({ ...writes }),
    locks: () => ({ receipt: receiptLockOwner, request: lockOwner }),
    waitForBlocked: (name) => blockedSignal(name).promise,
  };
}

test('correction-first makes the waiting handoff fail its completeness gate without handoff writes', async () => {
  const protocol = createReceiptHandoffProtocol();
  const correction = await protocol.correct();
  const handoff = protocol.handoff().then(() => null, (error) => error);
  await protocol.waitForBlocked('handoff');

  assert.deepEqual(protocol.locks(), { receipt: 'correction', request: 'correction' });
  correction.commit();
  const error = await handoff;

  assert.equal(error.status, 409);
  assert.equal(error.message, 'Stone and certificate arrivals must be complete before handoff');
  assert.deepEqual(protocol.state(), { transferStatus: 'ready_for_rep', complete: false });
  assert.deepEqual(protocol.writes(), { correction: 1, handoff: 0 });
});

test('handoff-first makes the waiting correction reject without correction writes', async () => {
  const protocol = createReceiptHandoffProtocol();
  const handoff = await protocol.handoff();
  const correction = protocol.correct().then(() => null, (error) => error);
  await protocol.waitForBlocked('correction');

  assert.deepEqual(protocol.locks(), { receipt: 'correction', request: 'handoff' });
  handoff.commit();
  const error = await correction;

  assert.equal(error.status, 409);
  assert.equal(error.message, 'This shipment was already handed to the sales rep');
  assert.deepEqual(protocol.state(), { transferStatus: 'handed_to_rep', complete: true });
  assert.deepEqual(protocol.writes(), { correction: 0, handoff: 1 });
});
