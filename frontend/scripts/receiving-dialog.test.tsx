import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { ModalDialog } from '../src/components/ui';
import { THEMES } from '../src/lib/theme';

const t = THEMES.light;
const originalWindow = globalThis.window;

function installWindow() {
  const keyListeners = new Set<(event: { key: string; stopPropagation: () => void }) => void>();
  (globalThis as typeof globalThis & { window?: unknown }).window = {
    addEventListener: (type: string, listener: (event: { key: string; stopPropagation: () => void }) => void) => {
      if (type === 'keydown') keyListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: { key: string; stopPropagation: () => void }) => void) => {
      if (type === 'keydown') keyListeners.delete(listener);
    },
  };
  return {
    pressKey(key: string) {
      for (const listener of [...keyListeners]) listener({ key, stopPropagation() {} });
    },
    get listenerCount() { return keyListeners.size; },
  };
}

test.afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as typeof globalThis & { window?: unknown }).window;
  } else {
    (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
  }
});

function renderDialog(onRequestClose: () => void) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ModalDialog labelledBy="title" onRequestClose={onRequestClose} width={500} t={t}>
        <div id="title">Scan shipment</div>
      </ModalDialog>
    );
  });
  return renderer;
}

test('a modal is announced as a dialog and points at its own title', () => {
  installWindow();
  const renderer = renderDialog(() => {});

  const dialog = renderer.root.find((node) => node.props?.role === 'dialog');
  assert.equal(dialog.props['aria-modal'], 'true');
  assert.equal(dialog.props['aria-labelledby'], 'title');
  assert.equal(dialog.props.tabIndex, -1, 'the panel must be focusable to receive focus on open');
});

test('Escape and the backdrop both route through the single close handler', () => {
  const viewport = installWindow();
  let closes = 0;
  const renderer = renderDialog(() => { closes += 1; });

  act(() => { viewport.pressKey('Escape'); });
  assert.equal(closes, 1, 'Escape must request a close');

  act(() => { viewport.pressKey('a'); });
  assert.equal(closes, 1, 'other keys must not close');

  const overlay = renderer.root.find((node) => node.props?.onMouseDown);
  const target = {};
  act(() => { overlay.props.onMouseDown({ target, currentTarget: target }); });
  assert.equal(closes, 2, 'a backdrop press must request a close');

  act(() => { overlay.props.onMouseDown({ target: {}, currentTarget: target }); });
  assert.equal(closes, 2, 'a press inside the panel must not close it');
});

test('the keydown listener is removed on unmount', () => {
  const viewport = installWindow();
  const renderer = renderDialog(() => {});
  assert.equal(viewport.listenerCount, 1);

  act(() => { renderer.unmount(); });
  assert.equal(viewport.listenerCount, 0);
});

test('closing the scan batch with unsaved rows asks before discarding them', async () => {
  const source = await readFile(resolve(__dirname, '../src/app/dashboard/receiving/page.tsx'), 'utf8');

  // Close must go through the guard, never straight to the destructive path.
  assert.match(source, /function requestCloseBatch\(\)/);
  assert.match(
    source,
    /if \(unsavedBatchRows\.length > 0\) \{\s*setConfirmDiscard\(true\);\s*return;/,
    'unsaved rows must stop the close and raise a confirmation'
  );
  assert.match(source, /onClick=\{requestCloseBatch\}/, 'the Close button must use the guard');
  assert.match(source, /onRequestClose=\{requestCloseBatch\}/, 'Escape and backdrop must use the guard too');

  // Only the explicit confirmation may clear the rows.
  const discard = source.slice(source.indexOf('function discardBatch()'));
  assert.match(discard.slice(0, 400), /setBatchRows\(\[\]\)/);
  assert.equal(
    /onClick=\{discardBatch\}/.test(source),
    true,
    'the discard action must be reachable only from the confirmation'
  );
  assert.equal(
    /onClick=\{closeBatch\}/.test(source),
    false,
    'the unguarded close must no longer be wired to anything'
  );
});

test('both receiving modals use the shared dialog rather than a bare overlay', async () => {
  const source = await readFile(resolve(__dirname, '../src/app/dashboard/receiving/page.tsx'), 'utf8');

  assert.equal((source.match(/<ModalDialog/g) || []).length, 2, 'both modals must be dialogs');
  assert.equal(
    /position: 'fixed', inset: 0, zIndex: 50/.test(source),
    false,
    'no hand-rolled modal overlay should remain'
  );
});
