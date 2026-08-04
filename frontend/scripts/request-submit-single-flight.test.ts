import assert from 'node:assert/strict';
import test from 'node:test';
import { createSingleFlight } from '../src/lib/singleFlight';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test('shared submit gate sends one request when manual and invoice paths fire together', async () => {
  const gate = createSingleFlight();
  const pending = deferred<void>();
  const sources: string[] = [];
  let cart = ['STONE-1'];
  const messages: string[] = [];

  const submit = (source: 'manual' | 'invoice_upload') => gate.run(async () => {
    sources.push(source);
    await pending.promise;
    cart = [];
    messages.push('sent');
  });

  const manual = submit('manual');
  const invoice = submit('invoice_upload');

  assert.deepEqual(sources, ['manual']);
  assert.equal(gate.inFlight, true);

  pending.resolve();
  await Promise.all([manual, invoice]);

  assert.deepEqual(sources, ['manual']);
  assert.deepEqual(cart, []);
  assert.deepEqual(messages, ['sent']);
  assert.equal(gate.inFlight, false);
});

test('failed submit preserves the cart, reports once, and releases the gate for retry', async () => {
  const gate = createSingleFlight();
  const first = deferred<void>();
  let calls = 0;
  let cart = ['STONE-1'];
  const errors: string[] = [];

  const submit = () => gate.run(async () => {
    calls += 1;
    try {
      await (calls === 1 ? first.promise : Promise.resolve());
      cart = [];
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Could not send this request.');
    }
  });

  const failed = submit();
  const duplicate = submit();
  assert.equal(calls, 1);

  first.reject(new Error('Inventory unavailable'));
  await Promise.all([failed, duplicate]);

  assert.deepEqual(cart, ['STONE-1']);
  assert.deepEqual(errors, ['Inventory unavailable']);
  assert.equal(gate.inFlight, false);

  await submit();
  assert.equal(calls, 2);
  assert.deepEqual(cart, []);
});
