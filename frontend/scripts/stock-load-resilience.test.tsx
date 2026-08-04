import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import StockPage from '../src/app/dashboard/stock/page';
import { ThemeProvider } from '../src/lib/ThemeProvider';
import { api, LooseStone } from '../src/lib/api';

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

const row = (barcode: string): LooseStone => ({
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

const originalLooseStock = api.looseStock;
const originalStockOptions = api.stockOptions;

function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return textOf((node as { children: unknown }).children);
  }
  return '';
}

function mounted(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ThemeProvider storageKey="stock-load-test">
        <StockPage />
      </ThemeProvider>
    );
  });
  return renderer;
}

test.afterEach(() => {
  api.looseStock = originalLooseStock;
  api.stockOptions = originalStockOptions;
});

test('mounted stock page exits loading after rejection, retries, then clears the alert and renders rows', async () => {
  const first = deferred<{ rows: LooseStone[]; total: number; page: number; pageSize: number }>();
  api.looseStock = async () => first.promise;
  api.stockOptions = async () => ({ shapes: [], labs: [], categories: [], metals: [], statuses: [] });
  const renderer = mounted();

  await act(async () => {
    first.reject(new Error('Connection lost'));
    await Promise.resolve();
  });

  assert.equal(textOf(renderer.toJSON()).includes('Loading…'), false);
  const alert = renderer.root.findByProps({ role: 'alert' });
  assert.match(textOf(alert), /Unable to load stock\. Connection lost/);

  api.looseStock = async () => ({ rows: [row('RETRY-ROW')], total: 1, page: 1, pageSize: 50 });
  await act(async () => {
    renderer.root.findAllByType('button').find((button) => textOf(button) === 'Retry')?.props.onClick();
    await Promise.resolve();
  });

  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
  assert.match(textOf(renderer.toJSON()), /RETRY-ROW/);
  renderer.unmount();
});

test('a stale failed request cannot replace the current rows with an error', async () => {
  const first = deferred<{ rows: LooseStone[]; total: number; page: number; pageSize: number }>();
  const second = deferred<{ rows: LooseStone[]; total: number; page: number; pageSize: number }>();
  let calls = 0;
  api.looseStock = async () => (++calls === 1 ? first.promise : second.promise);
  api.stockOptions = async () => ({ shapes: [], labs: [], categories: [], metals: [], statuses: [] });
  const renderer = mounted();

  await act(async () => {
    renderer.root.findByProps({ placeholder: 'e.g. 268140-003A' }).props.onChange({ target: { value: 'new search' } });
    await Promise.resolve();
  });
  await act(async () => {
    second.resolve({ rows: [row('CURRENT-ROW')], total: 1, page: 1, pageSize: 50 });
    await Promise.resolve();
  });
  await act(async () => {
    first.reject(new Error('Old request failed'));
    await Promise.resolve();
  });

  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
  assert.match(textOf(renderer.toJSON()), /CURRENT-ROW/);
  renderer.unmount();
});

test('a stale successful request cannot overwrite newer rows', async () => {
  const first = deferred<{ rows: LooseStone[]; total: number; page: number; pageSize: number }>();
  const second = deferred<{ rows: LooseStone[]; total: number; page: number; pageSize: number }>();
  let calls = 0;
  api.looseStock = async () => (++calls === 1 ? first.promise : second.promise);
  api.stockOptions = async () => ({ shapes: [], labs: [], categories: [], metals: [], statuses: [] });
  const renderer = mounted();

  await act(async () => {
    renderer.root.findByProps({ placeholder: 'e.g. 268140-003A' }).props.onChange({ target: { value: 'new search' } });
    await Promise.resolve();
  });
  await act(async () => {
    second.resolve({ rows: [row('CURRENT-ROW')], total: 1, page: 1, pageSize: 50 });
    await Promise.resolve();
  });
  await act(async () => {
    first.resolve({ rows: [row('STALE-ROW')], total: 1, page: 1, pageSize: 50 });
    await Promise.resolve();
  });

  const rendered = textOf(renderer.toJSON());
  assert.match(rendered, /CURRENT-ROW/);
  assert.doesNotMatch(rendered, /STALE-ROW/);
  renderer.unmount();
});

test('a deferred successful stock load settles quietly after unmount', async () => {
  const first = deferred<{ rows: LooseStone[]; total: number; page: number; pageSize: number }>();
  api.looseStock = async () => first.promise;
  api.stockOptions = async () => ({ shapes: [], labs: [], categories: [], metals: [], statuses: [] });
  const renderer = mounted();
  renderer.unmount();

  await act(async () => {
    first.resolve({ rows: [row('UNMOUNTED-ROW')], total: 1, page: 1, pageSize: 50 });
    await Promise.resolve();
  });

  assert.equal(renderer.toJSON(), null);
});

test('a deferred failed stock load settles quietly after unmount', async () => {
  const first = deferred<{ rows: LooseStone[]; total: number; page: number; pageSize: number }>();
  api.looseStock = async () => first.promise;
  api.stockOptions = async () => ({ shapes: [], labs: [], categories: [], metals: [], statuses: [] });
  const renderer = mounted();
  renderer.unmount();

  await act(async () => {
    first.reject(new Error('Unmounted request failed'));
    await Promise.resolve();
  });

  assert.equal(renderer.toJSON(), null);
});
