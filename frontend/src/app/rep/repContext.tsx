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
