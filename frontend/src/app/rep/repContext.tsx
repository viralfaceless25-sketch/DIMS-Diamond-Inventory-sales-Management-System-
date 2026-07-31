'use client';

import { createContext, useContext } from 'react';
import type { Theme, ThemeName } from '@/lib/theme';

export interface ThemeCtx {
  theme: Theme;
  name: ThemeName;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeCtx | null>(null);

export function useTheme() {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('useTheme outside provider');
  return c;
}

export interface CartCtx {
  count: number;
  setCount: (n: number) => void;
}

export const CartContext = createContext<CartCtx | null>(null);

export function useCartBadge() {
  const c = useContext(CartContext);
  if (!c) throw new Error('useCartBadge outside provider');
  return c;
}

export interface StockFilterCtx {
  colors: string[];
  setColors: (values: string[]) => void;
  clarities: string[];
  setClarities: (values: string[]) => void;
  shapes: string[];
  setShapes: (values: string[]) => void;
  shapeOptions: string[];
}

export const StockFilterContext = createContext<StockFilterCtx | null>(null);

export function useStockFilters() {
  const c = useContext(StockFilterContext);
  if (!c) throw new Error('useStockFilters outside provider');
  return c;
}

// Lets the sidebar mini diamond search hand a picked barcode to the Request
// stones page directly when it's already mounted, instead of always going
// through router.push('/rep/request-stones?q=...'). A same-route push (query
// string only) still triggers a full Next.js navigation, which was observed
// to make the layout's usePathname()-gated FILTER STOCK panel flicker.
// term is bumped with a counter suffix so picking the same barcode twice in a
// row still re-triggers the effect that reads it.
export interface QuickSearchCtx {
  term: string;
  setTerm: (barcode: string) => void;
}

export const QuickSearchContext = createContext<QuickSearchCtx | null>(null);

export function useQuickSearch() {
  const c = useContext(QuickSearchContext);
  if (!c) throw new Error('useQuickSearch outside provider');
  return c;
}
