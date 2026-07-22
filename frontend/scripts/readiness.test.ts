import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForApiReady } from '../src/lib/readiness';

function tickingClock() {
  let value = 0;
  return () => value++;
}

test('returns ready after a sleeping API wakes', async () => {
  let calls = 0;
  const result = await waitForApiReady('https://api.example.com', {
    fetcher: async () => ({ ok: ++calls === 3 } as Response),
    sleep: async () => undefined,
    timeoutMs: 90_000,
    intervalMs: 1,
    now: tickingClock(),
  });

  assert.equal(result, 'ready');
  assert.equal(calls, 3);
});

test('returns timeout when the API stays unavailable', async () => {
  const result = await waitForApiReady('https://api.example.com', {
    fetcher: async () => ({ ok: false } as Response),
    sleep: async () => undefined,
    timeoutMs: 2,
    intervalMs: 1,
    now: tickingClock(),
  });

  assert.equal(result, 'timeout');
});

test('checks only the readiness endpoint and never replays application writes', async () => {
  const urls: string[] = [];
  await waitForApiReady('https://api.example.com/', {
    fetcher: async (input) => {
      urls.push(String(input));
      return { ok: true } as Response;
    },
    now: tickingClock(),
  });

  assert.deepEqual(urls, ['https://api.example.com/ready']);
});

test('aborts a stalled readiness request so the overall wait stays bounded', async () => {
  let aborted = false;
  const result = await waitForApiReady('https://api.example.com', {
    fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    }),
    sleep: async () => undefined,
    now: tickingClock(),
    timeoutMs: 2,
    intervalMs: 0,
    requestTimeoutMs: 1,
  });

  assert.equal(result, 'timeout');
  assert.equal(aborted, true);
});
