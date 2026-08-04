import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import RequestsPage from '../src/app/dashboard/requests/page';
import MyRequestsPage from '../src/app/rep/my-requests/page';
import { AuthProvider } from '../src/lib/auth';
import { ThemeProvider } from '../src/lib/ThemeProvider';
import { ThemeContext } from '../src/app/rep/repContext';
import { THEMES } from '../src/lib/theme';
import { api, type MyRequest, type RequestDetail, type RequestStats, type RequestSummary, type User } from '../src/lib/api';
import { parseRequestDeepLinkId } from '../src/lib/requestDeepLink';

const inventoryUser: User = {
  id: 1, email: 'inventory@example.com', role: 'inventory', salesRepId: null,
  name: 'Inventory', branch: 'NY', mustChangePassword: false,
};
const salesUser: User = {
  id: 2, email: 'sales@example.com', role: 'sales_rep', salesRepId: 22,
  name: 'Sales', branch: 'LA', mustChangePassword: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

function summary(id: number): RequestSummary {
  return {
    id, branch: 'NY', fulfillmentBranch: 'NY', deliveryBranch: 'NY', crossBranch: false,
    deliveryRoute: null, paperworkType: 'none', transferStatus: null, resolutionConfirmed: false,
    requestedAt: '2026-08-01T00:00:00.000Z', status: 'awaiting', source: 'manual',
    requestScope: 'stone_and_cert', requestType: 'local', dropoffCompany: null, dropoffAddress: null,
    rep: { id: 22, name: 'Sales' }, stoneCount: 1, stoneFoundCount: 0, certFoundCount: 0,
    hasDuplicate: false, workflowVersion: 1, erpTransferConfirmed: false,
  };
}

function detail(id: number): RequestDetail {
  return { ...summary(id), stones: [] };
}

function salesRequest(id: number): MyRequest {
  return { ...summary(id), stones: [] };
}

function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'children' in node) return textOf((node as { children: unknown }).children);
  return '';
}

function button(renderer: ReactTestRenderer, label: string) {
  const found = renderer.root.findAllByType('button').find((node) => textOf(node) === label);
  assert.ok(found, `expected ${label} button`);
  return found;
}

function installBrowser() {
  (globalThis as { window?: unknown }).window = {
    location: { protocol: 'http:', hostname: 'localhost', pathname: '/' },
    localStorage: { getItem: () => 'test-token', setItem() {}, removeItem() {} },
    setTimeout(callback: () => void) { callback(); return 1; },
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
    alert() {},
  };
  (globalThis as { document?: unknown }).document = {
    getElementById: () => ({ scrollIntoView() {} }),
  };
}

function mountedInventory(search: string): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AppRouterContext.Provider value={{ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never}>
        <SearchParamsContext.Provider value={new URLSearchParams(search)}>
          <AuthProvider><ThemeProvider storageKey="deep-link-test"><RequestsPage /></ThemeProvider></AuthProvider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>
    );
  });
  return renderer;
}

function mountedSales(search: string): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AppRouterContext.Provider value={{ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never}>
        <SearchParamsContext.Provider value={new URLSearchParams(search)}>
          <AuthProvider>
            <ThemeContext.Provider value={{ theme: THEMES.dark, name: 'dark', toggle() {} }}><MyRequestsPage /></ThemeContext.Provider>
          </AuthProvider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>
    );
  });
  return renderer;
}

const original = {
  me: api.me, stats: api.stats, requests: api.requests, stockRecheckQueue: api.stockRecheckQueue,
  requestDetail: api.requestDetail, markRequestViewed: api.markRequestViewed, myRequests: api.myRequests,
};

test.afterEach(() => {
  api.me = original.me;
  api.stats = original.stats;
  api.requests = original.requests;
  api.stockRecheckQueue = original.stockRecheckQueue;
  api.requestDetail = original.requestDetail;
  api.markRequestViewed = original.markRequestViewed;
  api.myRequests = original.myRequests;
});

test('parses notification request IDs as positive decimal integers only', () => {
  assert.equal(parseRequestDeepLinkId('41'), 41);
  for (const value of [null, '', ' 41', '41 ', '4.1', '0', '-1', '1e2', 'abc', '9007199254740992']) {
    assert.equal(parseRequestDeepLinkId(value), null, `expected ${String(value)} to be rejected`);
  }
});

test('mounted inventory deep link opens once, marks viewed once, and suppresses repeated list effects', async () => {
  installBrowser();
  api.me = async () => inventoryUser;
  api.stats = async () => ({ pendingRequests: 1, stonesRequested: 1, duplicateFlags: 0, fulfilledRequests: 0, cancelledRequests: 0 } satisfies RequestStats);
  api.stockRecheckQueue = async () => ({ rows: [] });
  api.requests = async () => [summary(41)];
  let detailCalls = 0;
  let viewCalls = 0;
  api.requestDetail = async () => { detailCalls += 1; return detail(41); };
  api.markRequestViewed = async () => { viewCalls += 1; return { id: 41, inventoryViewedAt: '2026-08-01T00:00:00.000Z', inventoryViewedBy: 1, firstView: true }; };

  const renderer = mountedInventory('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  assert.equal(detailCalls, 1);
  assert.equal(viewCalls, 1);
  assert.match(textOf(renderer.toJSON()), /Request #41/);
  renderer.unmount();
});

test('mounted inventory retries a failed detail request and shows an actionable alert', async () => {
  installBrowser();
  api.me = async () => inventoryUser;
  api.stats = async () => ({ pendingRequests: 1, stonesRequested: 1, duplicateFlags: 0, fulfilledRequests: 0, cancelledRequests: 0 } satisfies RequestStats);
  api.stockRecheckQueue = async () => ({ rows: [] });
  api.requests = async () => [summary(41)];
  let calls = 0;
  api.requestDetail = async () => {
    calls += 1;
    if (calls === 1) throw new Error('Detail unavailable');
    return detail(41);
  };
  api.markRequestViewed = async () => ({ id: 41, inventoryViewedAt: null, inventoryViewedBy: null, firstView: false });

  const renderer = mountedInventory('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.match(textOf(renderer.root.findByProps({ role: 'alert' })), /Detail unavailable/);
  await act(async () => { button(renderer, 'Retry').props.onClick(); await Promise.resolve(); await Promise.resolve(); });
  assert.equal(calls, 2);
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
  renderer.unmount();
});

test('mounted inventory exposes retry when its notification list load fails', async () => {
  installBrowser();
  api.me = async () => inventoryUser;
  api.stats = async () => { throw new Error('Queue unavailable'); };
  api.requests = async () => [summary(41)];
  api.stockRecheckQueue = async () => ({ rows: [] });

  const renderer = mountedInventory('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  assert.match(textOf(renderer.root.findByProps({ role: 'alert' })), /Queue unavailable/);
  assert.ok(renderer.root.findAllByType('button').some((node) => textOf(node) === 'Retry'));
  renderer.unmount();
});

test('mounted inventory shares the in-flight open between notification and manual clicks', async () => {
  installBrowser();
  api.me = async () => inventoryUser;
  api.stats = async () => ({ pendingRequests: 1, stonesRequested: 1, duplicateFlags: 0, fulfilledRequests: 0, cancelledRequests: 0 } satisfies RequestStats);
  api.stockRecheckQueue = async () => ({ rows: [] });
  api.requests = async () => [summary(41)];
  const pending = deferred<RequestDetail>();
  let detailCalls = 0;
  api.requestDetail = async () => { detailCalls += 1; return pending.promise; };
  api.markRequestViewed = async () => ({ id: 41, inventoryViewedAt: null, inventoryViewedBy: null, firstView: false });

  const renderer = mountedInventory('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const requestCard = renderer.root.findAllByType('div').find((node) =>
    typeof node.props.onClick === 'function' && textOf(node).includes('Request #41')
  );
  assert.ok(requestCard, 'expected the request card click target');
  await act(async () => { requestCard.props.onClick(); await Promise.resolve(); });
  assert.equal(detailCalls, 1);

  await act(async () => { pending.resolve(detail(41)); await Promise.resolve(); });
  renderer.unmount();
});

test('mounted inventory keeps a manual expand failure out of notification recovery', async () => {
  installBrowser();
  let alerts = 0;
  (globalThis as { window: { alert: () => void } }).window.alert = () => { alerts += 1; };
  api.me = async () => inventoryUser;
  api.stats = async () => ({ pendingRequests: 1, stonesRequested: 1, duplicateFlags: 0, fulfilledRequests: 0, cancelledRequests: 0 } satisfies RequestStats);
  api.stockRecheckQueue = async () => ({ rows: [] });
  api.requests = async () => [summary(41)];
  api.requestDetail = async () => { throw new Error('Manual detail unavailable'); };

  const renderer = mountedInventory('');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const requestCard = renderer.root.findAllByType('div').find((node) =>
    typeof node.props.onClick === 'function' && textOf(node).includes('Request #41')
  );
  assert.ok(requestCard, 'expected the request card click target');
  await act(async () => { requestCard.props.onClick(); await Promise.resolve(); });

  assert.equal(alerts, 1);
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
  renderer.unmount();
});

test('mounted inventory searches completed once when an active notification target moved', async () => {
  installBrowser();
  api.me = async () => inventoryUser;
  api.stats = async () => ({ pendingRequests: 0, stonesRequested: 0, duplicateFlags: 0, fulfilledRequests: 1, cancelledRequests: 0 } satisfies RequestStats);
  api.stockRecheckQueue = async () => ({ rows: [] });
  const views: string[] = [];
  api.requests = async ({ view }) => { views.push(view); return view === 'completed' ? [summary(41)] : []; };
  api.requestDetail = async () => detail(41);
  api.markRequestViewed = async () => ({ id: 41, inventoryViewedAt: null, inventoryViewedBy: null, firstView: false });

  const renderer = mountedInventory('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  assert.deepEqual(views.filter((view) => view === 'completed'), ['completed']);
  assert.match(textOf(renderer.toJSON()), /Request #41/);
  renderer.unmount();
});

test('mounted inventory shows recovery controls for malformed and missing targets without detail mutations', async () => {
  installBrowser();
  api.me = async () => inventoryUser;
  api.stats = async () => ({ pendingRequests: 0, stonesRequested: 0, duplicateFlags: 0, fulfilledRequests: 0, cancelledRequests: 0 } satisfies RequestStats);
  api.stockRecheckQueue = async () => ({ rows: [] });
  api.requests = async () => [];
  let detailCalls = 0;
  api.requestDetail = async () => { detailCalls += 1; return detail(41); };
  api.markRequestViewed = async () => ({ id: 41, inventoryViewedAt: null, inventoryViewedBy: null, firstView: false });

  const malformed = mountedInventory('requestId=4.1');
  await act(async () => { await Promise.resolve(); });
  assert.match(textOf(malformed.root.findByProps({ role: 'alert' })), /valid request number/i);
  malformed.unmount();

  const missing = mountedInventory('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  assert.match(textOf(missing.root.findByProps({ role: 'alert' })), /could not be found/i);
  assert.ok(missing.root.findAllByType('button').some((node) => textOf(node) === 'Retry'));
  assert.equal(detailCalls, 0);
  missing.unmount();
});

test('mounted inventory discards a deep-link detail completion after unmount', async () => {
  installBrowser();
  api.me = async () => inventoryUser;
  api.stats = async () => ({ pendingRequests: 1, stonesRequested: 1, duplicateFlags: 0, fulfilledRequests: 0, cancelledRequests: 0 } satisfies RequestStats);
  api.stockRecheckQueue = async () => ({ rows: [] });
  api.requests = async () => [summary(41)];
  const pending = deferred<RequestDetail>();
  let viewCalls = 0;
  api.requestDetail = async () => pending.promise;
  api.markRequestViewed = async () => { viewCalls += 1; return { id: 41, inventoryViewedAt: null, inventoryViewedBy: null, firstView: false }; };

  const renderer = mountedInventory('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => { renderer.unmount(); });
  await act(async () => { pending.resolve(detail(41)); await Promise.resolve(); });

  assert.equal(viewCalls, 0);
  assert.equal(renderer.toJSON(), null);
});

test('mounted sales deep link opens matching requests and reports malformed or missing IDs with retry', async () => {
  installBrowser();
  api.me = async () => salesUser;
  api.myRequests = async () => [salesRequest(41)];
  const success = mountedSales('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.match(textOf(success.toJSON()), /STOCK #/);
  success.unmount();

  let missingLoads = 0;
  api.myRequests = async () => { missingLoads += 1; return []; };
  const missing = mountedSales('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.match(textOf(missing.root.findByProps({ role: 'alert' })), /could not be found/i);
  assert.ok(missing.root.findAllByType('button').some((node) => textOf(node) === 'Retry'));
  await act(async () => { button(missing, 'Retry').props.onClick(); await Promise.resolve(); await Promise.resolve(); });
  assert.ok(missingLoads >= 2, 'retry should request the sales list again');
  missing.unmount();

  const malformed = mountedSales('requestId=1e2');
  await act(async () => { await Promise.resolve(); });
  assert.match(textOf(malformed.root.findByProps({ role: 'alert' })), /valid request number/i);
  malformed.unmount();
});

test('mounted sales exposes retry when its notification list load fails', async () => {
  installBrowser();
  api.me = async () => salesUser;
  api.myRequests = async () => { throw new Error('Sales list unavailable'); };

  const renderer = mountedSales('requestId=41');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  assert.match(textOf(renderer.root.findByProps({ role: 'alert' })), /Sales list unavailable/);
  assert.ok(renderer.root.findAllByType('button').some((node) => textOf(node) === 'Retry'));
  renderer.unmount();
});
