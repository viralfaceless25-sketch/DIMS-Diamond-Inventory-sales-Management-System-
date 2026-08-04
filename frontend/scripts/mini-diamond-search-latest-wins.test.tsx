import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { MiniDiamondSearch } from '../src/components/MiniDiamondSearch';
import { api, LooseStone } from '../src/lib/api';
import { THEMES } from '../src/lib/theme';
import { QuickSearchContext, StockFilterContext } from '../src/app/rep/repContext';

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

const stock = (barcode: string): LooseStone => ({
  barcode,
  branch: 'NY',
  lab: null,
  certificate_no: null,
  shape: null,
  carat: null,
  color: null,
  clarity: null,
  cut: null,
  polish: null,
  symmetry: null,
  length_mm: null,
  width_mm: null,
  height_mm: null,
  lw_ratio: null,
  availability: { status: 'in_stock' },
});

const result = (rows: LooseStone[]) => ({ rows, total: rows.length, page: 1, pageSize: 6 });

function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'children' in node) return textOf((node as { children: unknown }).children);
  return '';
}

function mounted(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AppRouterContext.Provider value={{ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never}>
        <PathnameContext.Provider value="/rep">
          <StockFilterContext.Provider value={{ colors: [], setColors() {}, clarities: [], setClarities() {}, shapes: [], setShapes() {}, shapeOptions: [] }}>
            <QuickSearchContext.Provider value={{ term: '', setTerm() {} }}>
              <MiniDiamondSearch t={THEMES.dark} />
            </QuickSearchContext.Provider>
          </StockFilterContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    );
  });
  return renderer;
}

function searchInput(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ 'aria-label': 'Search diamonds' });
}

function waitForDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 275));
}

async function search(renderer: ReactTestRenderer, value: string) {
  await act(async () => {
    searchInput(renderer).props.onChange({ target: { value } });
    await waitForDebounce();
  });
}

const originalLooseStock = api.looseStock;
const originalStockOptions = api.stockOptions;

test.beforeEach(() => {
  (globalThis as { window?: unknown }).window = { setTimeout, clearTimeout };
  (globalThis as { document?: unknown }).document = { addEventListener() {}, removeEventListener() {} };
  api.stockOptions = async () => ({ shapes: [], labs: [], categories: [], metals: [], statuses: [] });
});

test.afterEach(() => {
  api.looseStock = originalLooseStock;
  api.stockOptions = originalStockOptions;
});

test('a stale single-result success cannot overwrite newer sidebar results', async () => {
  const first = deferred<ReturnType<typeof result>>();
  const second = deferred<ReturnType<typeof result>>();
  let calls = 0;
  api.looseStock = async () => (++calls === 1 ? first.promise : second.promise);
  const renderer = mounted();

  await search(renderer, 'older');
  await search(renderer, 'newer');
  await act(async () => {
    second.resolve(result([stock('CURRENT-SINGLE')]));
    await Promise.resolve();
  });
  await act(async () => {
    first.resolve(result([stock('STALE-SINGLE')]));
    await Promise.resolve();
  });

  const rendered = textOf(renderer.toJSON());
  assert.match(rendered, /CURRENT-SINGLE/);
  assert.doesNotMatch(rendered, /STALE-SINGLE/);
  renderer.unmount();
});

test('a stale failure cannot clear current rows or a newer loading indicator', async () => {
  const first = deferred<ReturnType<typeof result>>();
  const second = deferred<ReturnType<typeof result>>();
  const third = deferred<ReturnType<typeof result>>();
  let calls = 0;
  api.looseStock = async () => [first, second, third][calls++].promise;
  const renderer = mounted();

  await search(renderer, 'older');
  await search(renderer, 'current');
  await act(async () => {
    second.resolve(result([stock('CURRENT-ROW')]));
    await Promise.resolve();
  });
  await search(renderer, 'latest');
  await act(async () => {
    first.reject(new Error('old request failed'));
    await Promise.resolve();
  });

  const rendered = textOf(renderer.toJSON());
  assert.match(rendered, /CURRENT-ROW/);
  assert.match(rendered, /Searching…/);
  await act(async () => {
    third.resolve(result([stock('LATEST-ROW')]));
    await Promise.resolve();
  });
  renderer.unmount();
});

test('clearing an in-flight search leaves the sidebar empty and closed', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  api.looseStock = async () => pending.promise;
  const renderer = mounted();

  await search(renderer, 'active');
  await act(async () => {
    searchInput(renderer).props.onChange({ target: { value: 'x' } });
    await Promise.resolve();
  });
  assert.equal(textOf(renderer.toJSON()), '');
  await act(async () => {
    pending.resolve(result([stock('SHOULD-NOT-RETURN')]));
    await Promise.resolve();
  });

  const rendered = textOf(renderer.toJSON());
  assert.doesNotMatch(rendered, /SHOULD-NOT-RETURN/);
  assert.doesNotMatch(rendered, /Searching…/);
  renderer.unmount();
});

test('a stale multi-barcode aggregate cannot replace a newer search result', async () => {
  const first = deferred<ReturnType<typeof result>>();
  const second = deferred<ReturnType<typeof result>>();
  const newer = deferred<ReturnType<typeof result>>();
  let calls = 0;
  api.looseStock = async () => [first, second, newer][calls++].promise;
  const renderer = mounted();

  await act(async () => {
    renderer.root.findByProps({ 'aria-label': 'Diamond filters' }).props.onClick();
    await Promise.resolve();
  });
  await search(renderer, '12345-AA 23456-BB');
  await search(renderer, 'newer search');
  await act(async () => {
    first.resolve(result([stock('12345-AA')]));
    second.resolve(result([stock('23456-BB')]));
    await Promise.resolve();
  });
  let rendered = textOf(renderer.toJSON());
  assert.match(rendered, /Searching…/);
  assert.doesNotMatch(rendered, /12345-AA/);
  assert.doesNotMatch(rendered, /23456-BB/);
  await act(async () => {
    newer.resolve(result([stock('CURRENT-BATCH-REPLACEMENT')]));
    await Promise.resolve();
  });

  rendered = textOf(renderer.toJSON());
  assert.match(rendered, /CURRENT-BATCH-REPLACEMENT/);
  assert.doesNotMatch(rendered, /12345-AA/);
  assert.doesNotMatch(rendered, /23456-BB/);
  renderer.unmount();
});

test('the latest failed search clears loading and shows the existing empty state', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  api.looseStock = async () => pending.promise;
  const renderer = mounted();

  await act(async () => {
    renderer.root.findByProps({ 'aria-label': 'Diamond filters' }).props.onClick();
    await Promise.resolve();
  });
  await search(renderer, 'missing');
  await act(async () => {
    pending.reject(new Error('network down'));
    await Promise.resolve();
  });

  const rendered = textOf(renderer.toJSON());
  assert.match(rendered, /No diamonds found\./);
  assert.doesNotMatch(rendered, /Searching…/);
  renderer.unmount();
});

test('a deferred stock-options load settles quietly after the sidebar unmounts', async () => {
  const options = deferred<Awaited<ReturnType<typeof api.stockOptions>>>();
  api.stockOptions = async () => options.promise;
  const renderer = mounted();
  renderer.unmount();

  await act(async () => {
    options.resolve({ shapes: [], labs: ['GIA'], categories: [], metals: [], statuses: [] });
    await Promise.resolve();
  });

  assert.equal(renderer.toJSON(), null);
});

test('a deferred sidebar search settles quietly after unmount', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  api.looseStock = async () => pending.promise;
  const renderer = mounted();

  await search(renderer, 'active');
  renderer.unmount();
  await act(async () => {
    pending.resolve(result([stock('UNMOUNTED-ROW')]));
    await Promise.resolve();
  });

  assert.equal(renderer.toJSON(), null);
});
