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

// A deterministic model of the request row lock shared by the two receipt
// transactions. It makes the state seen after a waiter acquires the lock equal
// to the first transaction's committed state, which is the database guarantee
// this route relies on without requiring a live database in unit tests.
function createReceiptHandoffProtocol() {
  let lockOwner = null;
  const waiters = [];
  const blocked = new Map();
  const state = { transferStatus: 'ready_for_rep', complete: true };
  const writes = { correction: 0, handoff: 0 };

  function blockedSignal(name) {
    if (!blocked.has(name)) blocked.set(name, deferred());
    return blocked.get(name);
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
      await lock('correction');
      try {
        assertReceiptCorrectionAllowed({ transfer_status: state.transferStatus });
        return {
          commit() {
            state.complete = false;
            writes.correction += 1;
            unlock('correction');
          },
          rollback() { unlock('correction'); },
        };
      } catch (error) {
        unlock('correction');
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
    waitForBlocked: (name) => blockedSignal(name).promise,
  };
}

test('correction-first makes the waiting handoff fail its completeness gate without handoff writes', async () => {
  const protocol = createReceiptHandoffProtocol();
  const correction = await protocol.correct();
  const handoff = protocol.handoff().then(() => null, (error) => error);
  await protocol.waitForBlocked('handoff');

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

  handoff.commit();
  const error = await correction;

  assert.equal(error.status, 409);
  assert.equal(error.message, 'This shipment was already handed to the sales rep');
  assert.deepEqual(protocol.state(), { transferStatus: 'handed_to_rep', complete: true });
  assert.deepEqual(protocol.writes(), { correction: 0, handoff: 1 });
});
