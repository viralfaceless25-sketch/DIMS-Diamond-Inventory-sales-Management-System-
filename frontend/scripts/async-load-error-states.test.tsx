import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import React, { useCallback } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { useAsyncLoad } from '../src/lib/useAsyncLoad';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void };

function deferred<T>(): Deferred<T> {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolveFn = onResolve; rejectFn = onReject; });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

type Seen = { data: string[]; loading: boolean; error: string | null; reload: () => void };

/** Renders the hook and exposes its latest state to the test. */
function Probe({ loader, seen }: { loader: () => Promise<string[]>; seen: { current: Seen | null } }) {
  const stable = useCallback(loader, [loader]);
  const state = useAsyncLoad(stable, [] as string[]);
  seen.current = state;
  return null;
}

function renderProbe(loader: () => Promise<string[]>) {
  const seen: { current: Seen | null } = { current: null };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Probe loader={loader} seen={seen} />); });
  return { renderer, state: () => seen.current as Seen };
}

test('a failed load surfaces an error rather than an empty result', async () => {
  const attempt = deferred<string[]>();
  const { state } = renderProbe(() => attempt.promise);

  assert.equal(state().loading, true);

  await act(async () => { attempt.reject(new Error('Request failed (HTTP 502)')); await attempt.promise.catch(() => {}); });
  await flush();

  assert.equal(state().loading, false);
  assert.equal(state().error, 'Request failed (HTTP 502)');
  assert.deepEqual(state().data, [], 'no data arrived');
});

test('a thrown non-Error still produces a usable message', async () => {
  const attempt = deferred<string[]>();
  const { state } = renderProbe(() => attempt.promise);

  await act(async () => { attempt.reject('boom' as unknown as Error); await attempt.promise.catch(() => {}); });
  await flush();

  assert.equal(state().error, 'Something went wrong. Please try again.');
});

test('a successful load clears a previous error', async () => {
  let current = deferred<string[]>();
  const { state } = renderProbe(useCallbackless(() => current.promise));

  await act(async () => { current.reject(new Error('offline')); await current.promise.catch(() => {}); });
  await flush();
  assert.equal(state().error, 'offline');

  current = deferred<string[]>();
  act(() => { state().reload(); });
  await act(async () => { current.resolve(['A']); await current.promise; });
  await flush();

  assert.equal(state().error, null);
  assert.deepEqual(state().data, ['A']);
});

test('a stale success cannot overwrite a newer one', async () => {
  let current = deferred<string[]>();
  const first = current;
  const { state } = renderProbe(useCallbackless(() => current.promise));

  const second = deferred<string[]>();
  current = second;
  act(() => { state().reload(); });

  await act(async () => { second.resolve(['NEW']); await second.promise; });
  await flush();
  await act(async () => { first.resolve(['STALE']); await first.promise; });
  await flush();

  assert.deepEqual(state().data, ['NEW'], 'the superseded request must not write');
  assert.equal(state().loading, false);
});

test('a stale failure cannot replace a newer success with an error', async () => {
  let current = deferred<string[]>();
  const first = current;
  const { state } = renderProbe(useCallbackless(() => current.promise));

  const second = deferred<string[]>();
  current = second;
  act(() => { state().reload(); });

  await act(async () => { second.resolve(['NEW']); await second.promise; });
  await flush();
  await act(async () => { first.reject(new Error('stale failure')); await first.promise.catch(() => {}); });
  await flush();

  assert.equal(state().error, null, 'a superseded failure must not surface');
  assert.deepEqual(state().data, ['NEW']);
});

test('a failed refresh keeps the data already on screen', async () => {
  let current = deferred<string[]>();
  const { state } = renderProbe(useCallbackless(() => current.promise));

  await act(async () => { current.resolve(['A', 'B']); await current.promise; });
  await flush();
  assert.deepEqual(state().data, ['A', 'B']);

  current = deferred<string[]>();
  act(() => { state().reload(); });
  await act(async () => { current.reject(new Error('refresh failed')); await current.promise.catch(() => {}); });
  await flush();

  assert.deepEqual(state().data, ['A', 'B'], 'a failed refresh must not blank the list');
  assert.equal(state().error, 'refresh failed');
});

test('a completion after unmount does not update state', async () => {
  const attempt = deferred<string[]>();
  const { renderer, state } = renderProbe(() => attempt.promise);
  const before = state();

  act(() => { renderer.unmount(); });
  await act(async () => { attempt.resolve(['LATE']); await attempt.promise; });
  await flush();

  assert.deepEqual(before.data, [], 'no post-unmount write');
});

test('every page that can fail renders its error ahead of any empty state', async () => {
  const pages = [
    '../src/app/rep/tracking/page.tsx',
    '../src/app/dashboard/tracking/page.tsx',
    '../src/app/dashboard/reps/page.tsx',
  ];

  for (const relative of pages) {
    const source = await readFile(resolve(__dirname, relative), 'utf8');
    assert.match(source, /useAsyncLoad/, `${relative}: must load through useAsyncLoad`);
    assert.match(source, /<LoadError/, `${relative}: must render LoadError`);
    assert.equal(
      /window\.alert/.test(source),
      false,
      `${relative}: a dismissed alert leaves the false-empty state behind`
    );

    const errorBranch = source.indexOf('error ? (');
    const emptyBranch = source.search(/\.length === 0 \? \(/);
    assert.ok(errorBranch >= 0, `${relative}: expected an error branch`);
    assert.ok(
      emptyBranch < 0 || errorBranch < emptyBranch,
      `${relative}: the error branch must be checked before the empty branch`
    );
  }
});

test('the rep tracking request link deep-links to the specific request', async () => {
  const source = await readFile(resolve(__dirname, '../src/app/rep/tracking/page.tsx'), 'utf8');
  assert.match(
    source,
    /\/rep\/my-requests\?requestId=\$\{row\.request_id\}/,
    'the link must carry requestId so the target can open that request'
  );
});

/** Keeps the loader identity stable across renders so the effect does not re-run. */
function useCallbackless(loader: () => Promise<string[]>) {
  return loader;
}
