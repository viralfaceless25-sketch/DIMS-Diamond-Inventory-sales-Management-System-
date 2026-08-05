import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AppShell, NAVIGATION_ID, SIDEBAR_WIDTH } from '../src/components/AppShell';
import { THEMES } from '../src/lib/theme';

type MediaListener = (event: { matches: boolean }) => void;

const originalWindow = globalThis.window;
const t = THEMES.light;

/**
 * Installs a matchMedia whose result can be changed after mount, plus the
 * keydown listener registry the drawer's Escape handler needs.
 */
function installViewport(matches: boolean) {
  const mediaListeners = new Set<MediaListener>();
  const keyListeners = new Set<(event: { key: string }) => void>();
  let current = matches;

  const list = {
    get matches() { return current; },
    addEventListener: (_type: string, listener: MediaListener) => { mediaListeners.add(listener); },
    removeEventListener: (_type: string, listener: MediaListener) => { mediaListeners.delete(listener); },
  };

  (globalThis as typeof globalThis & { window?: unknown }).window = {
    matchMedia: () => list,
    addEventListener: (type: string, listener: (event: { key: string }) => void) => {
      if (type === 'keydown') keyListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: { key: string }) => void) => {
      if (type === 'keydown') keyListeners.delete(listener);
    },
  };

  return {
    resizeTo(next: boolean) {
      current = next;
      for (const listener of mediaListeners) listener({ matches: next });
    },
    pressKey(key: string) {
      for (const listener of [...keyListeners]) listener({ key });
    },
    get keyListenerCount() { return keyListeners.size; },
  };
}

test.afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as typeof globalThis & { window?: unknown }).window;
  } else {
    (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
  }
});

function renderShell(pathname = '/rep/request-stones') {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AppShell
        t={t}
        brand="Diamond ERP"
        pathname={pathname}
        sidebarStyle={{ display: 'flex', flexDirection: 'column', padding: '18px 14px' }}
        sidebar={<div>SIDEBAR CONTENT</div>}
      >
        <div>MAIN CONTENT</div>
      </AppShell>
    );
  });
  return renderer;
}

function rerenderShell(renderer: ReactTestRenderer, pathname: string) {
  act(() => {
    renderer.update(
      <AppShell
        t={t}
        brand="Diamond ERP"
        pathname={pathname}
        sidebarStyle={{ display: 'flex', flexDirection: 'column', padding: '18px 14px' }}
        sidebar={<div>SIDEBAR CONTENT</div>}
      >
        <div>MAIN CONTENT</div>
      </AppShell>
    );
  });
}

const byLabel = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll((node) => node.props?.['aria-label'] === label);

const sidebarVisible = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props?.children === 'SIDEBAR CONTENT').length > 0;

test('a wide viewport keeps the sidebar inline at its full width and shows no menu button', () => {
  installViewport(false);
  const renderer = renderShell();

  assert.equal(byLabel(renderer, 'Open navigation menu').length, 0);
  assert.ok(sidebarVisible(renderer));

  const sidebar = renderer.root.find((node) => node.props?.id === NAVIGATION_ID);
  assert.equal(sidebar.props.style.width, SIDEBAR_WIDTH);
  assert.equal(sidebar.props.style.flex, 'none');
});

test('a narrow viewport hides the sidebar so the main panel gets the whole width', () => {
  installViewport(true);
  const renderer = renderShell();

  assert.equal(
    sidebarVisible(renderer),
    false,
    'the sidebar must not consume horizontal space on a phone'
  );
  assert.equal(byLabel(renderer, 'Open navigation menu').length, 1);
  assert.equal(
    renderer.root.findAll((node) => node.props?.children === 'MAIN CONTENT').length,
    1,
    'main content must still render'
  );
});

test('the menu button opens a labelled drawer and reports its own expanded state', () => {
  installViewport(true);
  const renderer = renderShell();

  const opener = () => renderer.root.find((node) => node.props?.['aria-label'] === 'Open navigation menu');
  assert.equal(opener().props['aria-expanded'], false);
  assert.equal(opener().props['aria-controls'], NAVIGATION_ID);

  act(() => { opener().props.onClick(); });

  assert.ok(sidebarVisible(renderer), 'the drawer must reveal the sidebar');
  assert.equal(opener().props['aria-expanded'], true);
  const drawer = renderer.root.find((node) => node.props?.id === NAVIGATION_ID);
  assert.equal(drawer.props.style.position, 'fixed');
  assert.equal(drawer.props['aria-label'], 'Main navigation');
});

test('the drawer closes on its close button, on the backdrop, and on Escape', () => {
  const viewport = installViewport(true);
  const renderer = renderShell();
  const open = () => act(() => {
    renderer.root.find((node) => node.props?.['aria-label'] === 'Open navigation menu').props.onClick();
  });

  open();
  act(() => { byLabel(renderer, 'Close navigation menu')[0].props.onClick(); });
  assert.equal(sidebarVisible(renderer), false, 'close button must dismiss the drawer');

  open();
  const backdrop = renderer.root.find((node) => node.props?.['aria-hidden'] === 'true' && node.props?.onClick);
  act(() => { backdrop.props.onClick(); });
  assert.equal(sidebarVisible(renderer), false, 'the backdrop must dismiss the drawer');

  open();
  act(() => { viewport.pressKey('Escape'); });
  assert.equal(sidebarVisible(renderer), false, 'Escape must dismiss the drawer');

  act(() => { viewport.pressKey('a'); });
  assert.equal(sidebarVisible(renderer), false);
});

test('navigating closes the drawer so it never covers the page it just opened', () => {
  installViewport(true);
  const renderer = renderShell('/rep/request-stones');

  act(() => {
    renderer.root.find((node) => node.props?.['aria-label'] === 'Open navigation menu').props.onClick();
  });
  assert.ok(sidebarVisible(renderer));

  rerenderShell(renderer, '/rep/my-requests');
  assert.equal(sidebarVisible(renderer), false);
});

test('widening the viewport restores the inline sidebar instead of leaving a drawer on top of it', () => {
  const viewport = installViewport(true);
  const renderer = renderShell();

  act(() => {
    renderer.root.find((node) => node.props?.['aria-label'] === 'Open navigation menu').props.onClick();
  });
  assert.ok(sidebarVisible(renderer));

  act(() => { viewport.resizeTo(false); });

  assert.equal(byLabel(renderer, 'Open navigation menu').length, 0);
  const sidebar = renderer.root.find((node) => node.props?.id === NAVIGATION_ID);
  assert.equal(sidebar.props.style.position, undefined, 'the restored sidebar must be inline, not fixed');
  assert.equal(sidebar.props.style.width, SIDEBAR_WIDTH);
});

test('the Escape listener is removed when the drawer closes and on unmount', () => {
  const viewport = installViewport(true);
  const renderer = renderShell();

  act(() => {
    renderer.root.find((node) => node.props?.['aria-label'] === 'Open navigation menu').props.onClick();
  });
  assert.equal(viewport.keyListenerCount, 1);

  act(() => { viewport.pressKey('Escape'); });
  assert.equal(viewport.keyListenerCount, 0, 'closing must not leak a keydown listener');

  act(() => {
    renderer.root.find((node) => node.props?.['aria-label'] === 'Open navigation menu').props.onClick();
  });
  act(() => { renderer.unmount(); });
  assert.equal(viewport.keyListenerCount, 0, 'unmounting must not leak a keydown listener');
});

test('each role shell renders NotificationHost outside the sidebar node', async () => {
  // Placed inside `sidebar={...}` it unmounts whenever the narrow-viewport
  // drawer is closed, which silently stops notifications on a phone.
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');

  for (const relative of ['../src/app/rep/layout.tsx', '../src/app/dashboard/layout.tsx']) {
    const source = await readFile(resolve(__dirname, relative), 'utf8');
    const host = source.indexOf('<NotificationHost');
    const shell = source.indexOf('<AppShell');
    assert.ok(host >= 0 && shell >= 0, `${relative}: expected both components`);
    assert.ok(
      host < shell,
      `${relative}: NotificationHost must be a sibling of AppShell, not part of its sidebar`
    );
  }
});

test('server rendering assumes the wide layout so there is no hydration mismatch', () => {
  delete (globalThis as typeof globalThis & { window?: unknown }).window;

  const renderer = renderShell();

  assert.equal(byLabel(renderer, 'Open navigation menu').length, 0);
  assert.ok(sidebarVisible(renderer));
});
