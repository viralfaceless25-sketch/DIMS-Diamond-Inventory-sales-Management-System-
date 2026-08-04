import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { AuthProvider } from '../src/lib/auth';
import { api, LooseStone } from '../src/lib/api';
import { THEMES } from '../src/lib/theme';
import {
  CartContext,
  QuickSearchContext,
  StockFilterContext,
  ThemeContext,
} from '../src/app/rep/repContext';

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

const row: LooseStone = {
  barcode: 'STONE-1', branch: 'NY', lab: null, certificate_no: 'CERT-1',
  shape: 'Round', carat: 1, color: 'D', clarity: 'VVS1', cut: null,
  polish: null, symmetry: null, length_mm: null, width_mm: null,
  height_mm: null, lw_ratio: null, availability: { status: 'in_stock' },
};

function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return textOf((node as { children: unknown }).children);
  }
  return '';
}

function button(renderer: ReactTestRenderer, label: string) {
  const found = renderer.root.findAllByType('button').find((node) => textOf(node) === label);
  assert.ok(found, `expected ${label} button`);
  return found;
}

function mounted(Page: React.ComponentType): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AppRouterContext.Provider value={{ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never}>
        <SearchParamsContext.Provider value={new URLSearchParams()}>
          <AuthProvider>
            <ThemeContext.Provider value={{ theme: THEMES.dark, name: 'dark', toggle() {} }}>
              <CartContext.Provider value={{ count: 0, setCount() {} }}>
                <StockFilterContext.Provider value={{ colors: [], setColors() {}, clarities: [], setClarities() {}, shapes: [], setShapes() {}, shapeOptions: [] }}>
                  <QuickSearchContext.Provider value={{ term: '', setTerm() {} }}>
                    <Page />
                  </QuickSearchContext.Provider>
                </StockFilterContext.Provider>
              </CartContext.Provider>
            </ThemeContext.Provider>
          </AuthProvider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>
    );
  });
  return renderer;
}

const originalLooseStock = api.looseStock;
const originalMyStockRechecks = api.myStockRechecks;
const originalSubmitRequest = api.submitRequest;

test.afterEach(() => {
  api.looseStock = originalLooseStock;
  api.myStockRechecks = originalMyStockRechecks;
  api.submitRequest = originalSubmitRequest;
});

test('request page ignores a rapid duplicate submit, retains the failed cart, and permits retry', async () => {
  (globalThis as { window?: unknown }).window = {
    location: { protocol: 'http:', hostname: 'localhost', pathname: '/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const Page = (await import('../src/app/rep/request-stones/page')).default;
  api.looseStock = async () => ({ rows: [row], total: 1, page: 1, pageSize: 50 });
  api.myStockRechecks = async () => [];
  const first = deferred<Awaited<ReturnType<typeof api.submitRequest>>>();
  let calls = 0;
  api.submitRequest = async () => {
    calls += 1;
    return calls === 1 ? first.promise : {} as Awaited<ReturnType<typeof api.submitRequest>>;
  };

  const renderer = mounted(Page);
  await act(async () => { await Promise.resolve(); });

  const stockRow = renderer.root.findAllByType('div').find((node) =>
    typeof node.props.onClick === 'function'
      && node.props.style?.cursor === 'pointer'
      && textOf(node).includes('STONE-1')
  );
  assert.ok(stockRow, 'expected selectable stock row');
  await act(async () => {
    stockRow.props.onClick();
    await Promise.resolve();
  });

  const submit = button(renderer, 'Submit request to inventory');
  await act(async () => {
    submit.props.onClick();
    submit.props.onClick();
    await Promise.resolve();
  });

  assert.equal(calls, 1);
  assert.equal(button(renderer, 'Submitting request…').props.disabled, true);

  await act(async () => {
    first.reject(new Error('Inventory unavailable'));
    await Promise.resolve();
  });

  assert.match(textOf(renderer.toJSON()), /Inventory unavailable/);
  assert.match(textOf(renderer.toJSON()), /1 selected/);

  await act(async () => {
    button(renderer, 'Submit request to inventory').props.onClick();
    await Promise.resolve();
  });

  assert.equal(calls, 2);
  assert.match(textOf(renderer.toJSON()), /0 selected/);
  assert.match(textOf(renderer.toJSON()), /Request for 1 stone sent to inventory\./);
  renderer.unmount();
});
