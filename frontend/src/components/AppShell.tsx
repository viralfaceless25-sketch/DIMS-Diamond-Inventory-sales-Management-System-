'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Theme } from '@/lib/theme';
import { useNarrowViewport } from '@/lib/useNarrowViewport';

export const SIDEBAR_WIDTH = 224;
export const NAVIGATION_ID = 'app-shell-navigation';

type AppShellProps = {
  t: Theme;
  brand: string;
  /** Styling of the sidebar container, owned by the calling shell. */
  sidebarStyle: CSSProperties;
  sidebar: ReactNode;
  children: ReactNode;
  /** Current route. Changing it closes the drawer, so tapping a nav link
   *  does not leave the drawer covering the page it just opened. */
  pathname: string | null;
};

/**
 * Role shell that keeps the wide layout exactly as it was and turns the
 * sidebar into an off-canvas drawer on a narrow viewport.
 *
 * On a phone the previous layout gave the sidebar 224 of 390 available
 * pixels and the main panel the remaining 166, which made request pages
 * unusable. Here the main panel always gets the full width and the sidebar is
 * reachable through a labelled menu button.
 */
export function AppShell({ t, brand, sidebarStyle, sidebar, children, pathname }: AppShellProps) {
  const narrow = useNarrowViewport();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // A drawer left open while the viewport widens would sit on top of the
  // restored inline sidebar.
  useEffect(() => { if (!narrow) setOpen(false); }, [narrow]);
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Move focus into the drawer so a keyboard or screen-reader user is not
  // left behind on the menu button with the drawer covering the page.
  useEffect(() => { if (open) closeButtonRef.current?.focus(); }, [open]);

  const main = (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: t.bg }}>
      {children}
    </main>
  );

  if (!narrow) {
    return (
      <div style={{ display: 'flex', width: '100%', height: '100vh', background: t.bg, color: t.text, overflow: 'hidden' }}>
        <div id={NAVIGATION_ID} style={{ ...sidebarStyle, width: SIDEBAR_WIDTH, flex: 'none' }}>{sidebar}</div>
        {main}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', background: t.bg, color: t.text, overflow: 'hidden' }}>
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgSide }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          aria-controls={NAVIGATION_ID}
          style={{ width: 44, height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: t.bgCard, border: `1px solid ${t.border}`, cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={t.text} strokeWidth="1.9" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span style={{ font: "700 16px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand}</span>
      </header>

      {main}

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgb(0 0 0 / 0.45)' }}
          />
          <aside
            id={NAVIGATION_ID}
            aria-label="Main navigation"
            style={{ ...sidebarStyle, position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 61, width: 'min(280px, 85vw)', maxWidth: '85vw', overflowY: 'auto', overflowX: 'hidden', background: sidebarStyle.background ?? t.bgSide }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.textMuted} strokeWidth="1.9" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {sidebar}
          </aside>
        </>
      )}
    </div>
  );
}
