'use client';

import { createContext, useContext, useState, useMemo, useEffect, ReactNode } from 'react';
import { THEMES, ThemeName, Theme } from './theme';

interface ThemeCtx {
  theme: Theme;
  name: ThemeName;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

// `storageKey` lets the two apps remember their theme independently
// (the dashboard and the rep app each have their own toggle).
export function ThemeProvider({
  children,
  storageKey,
  defaultName = 'dark',
}: {
  children: ReactNode;
  storageKey: string;
  defaultName?: ThemeName;
}) {
  const [name, setName] = useState<ThemeName>(defaultName);

  // Restore saved choice on mount.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
    if (saved === 'light' || saved === 'dark') setName(saved);
  }, [storageKey]);

  const value = useMemo(
    () => ({
      theme: THEMES[name],
      name,
      toggle: () =>
        setName((n) => {
          const next = n === 'dark' ? 'light' : 'dark';
          if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, next);
          return next;
        }),
    }),
    [name, storageKey]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
