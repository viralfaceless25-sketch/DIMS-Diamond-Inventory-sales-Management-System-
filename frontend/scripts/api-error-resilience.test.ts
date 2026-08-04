import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../src/lib/api';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function respond(body: string, status: number) {
  globalThis.fetch = async () => new Response(body, { status });
}

function browserWithToken(token: string) {
  let storedToken: string | null = token;
  const location = { pathname: '/dashboard/stock', href: '' };
  const localStorage = {
    getItem: () => storedToken,
    setItem: (_key: string, value: string) => { storedToken = value; },
    removeItem: () => { storedToken = null; },
  };
  (globalThis as typeof globalThis & { window?: unknown }).window = { localStorage, location };
  return { location, token: () => storedToken };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete (globalThis as typeof globalThis & { window?: unknown }).window;
  } else {
    (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
  }
});

test('API errors use a stable HTTP message when an error response is not JSON', async () => {
  respond('<!doctype html><title>Bad Gateway</title>', 502);

  await assert.rejects(
    api.branches(),
    (error: unknown) => error instanceof Error && error.message === 'Request failed (HTTP 502)'
  );
});

test('API errors retain a valid JSON error message', async () => {
  respond('{"error":"Branch access denied"}', 403);

  await assert.rejects(
    api.branches(),
    (error: unknown) => error instanceof Error && error.message === 'Branch access denied'
  );
});

test('successful malformed JSON reports a response-format error', async () => {
  respond('{not-json}', 200);

  await assert.rejects(
    api.branches(),
    (error: unknown) => error instanceof Error && error.message === 'Response format error (HTTP 200)'
  );
});

test('401 API errors preserve a JSON error while clearing the session and redirecting', async () => {
  const browser = browserWithToken('session-token');
  respond('{"error":"Session revoked"}', 401);

  await assert.rejects(
    api.branches(),
    (error: unknown) => error instanceof Error && error.message === 'Session revoked'
  );
  assert.equal(browser.token(), null);
  assert.equal(browser.location.href, '/login');
});

test('401 HTML errors use a stable HTTP fallback while clearing the session and redirecting', async () => {
  const browser = browserWithToken('session-token');
  respond('<!doctype html><title>Unauthorized</title>', 401);

  await assert.rejects(
    api.branches(),
    (error: unknown) => error instanceof Error && error.message === 'Request failed (HTTP 401)'
  );
  assert.equal(browser.token(), null);
  assert.equal(browser.location.href, '/login');
});
