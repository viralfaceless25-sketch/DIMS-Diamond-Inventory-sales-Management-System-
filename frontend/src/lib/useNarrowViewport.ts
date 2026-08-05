'use client';

import { useEffect, useState } from 'react';

// Both role shells lay out as a fixed 224px sidebar beside the main panel.
// At 390px that leaves the main panel 166px wide, which is why primary
// content was unreachable on a phone. Below this width the sidebar becomes an
// off-canvas drawer instead.
//
// Every style in this app is an inline style object, so a CSS media query is
// not available — the breakpoint has to be read in JavaScript.
export const NARROW_VIEWPORT_QUERY = '(max-width: 900px)';

/**
 * True when the viewport is narrow enough that the sidebar must not take
 * permanent horizontal space.
 *
 * Starts false so the server and the first client render agree (there is no
 * viewport to measure during SSR); the real value is applied on mount.
 */
export function useNarrowViewport(query: string = NARROW_VIEWPORT_QUERY): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const apply = () => setNarrow(list.matches);
    apply();

    // Safari below 14 only has the deprecated addListener form.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', apply);
      return () => list.removeEventListener('change', apply);
    }
    list.addListener(apply);
    return () => list.removeListener(apply);
  }, [query]);

  return narrow;
}
