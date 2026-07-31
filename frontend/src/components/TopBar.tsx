'use client';

import { ACCENT, BRANCHES, Theme } from '@/lib/theme';

export function TopBar({
  title,
  branch,
  onBranch,
  lockBranch,
  search,
  onSearch,
  searchPlaceholder = 'Search rep, stock# or cert#',
  right,
  t,
}: {
  title: string;
  branch: string;
  onBranch: (b: string) => void;
  // When set, the selector is pinned to a single branch (an inventory room may
  // only ever view its own). The pills are replaced by a static badge so the UI
  // matches the server, which ignores any wider branch value for inventory.
  lockBranch?: string;
  search?: string;
  onSearch?: (s: string) => void;
  searchPlaceholder?: string;
  right?: React.ReactNode;
  t: Theme;
}) {
  const pills = ['ALL', ...BRANCHES];
  return (
    <div style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '0 26px', borderBottom: `1px solid ${t.border}`, background: t.bgSide }}>
      <div style={{ font: "700 18px 'Inter'", color: t.text, flex: 'none' }}>{title}</div>

      <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
        {lockBranch ? (
          <div
            style={{
              font: "600 13.5px 'Inter'",
              padding: '6px 13px',
              borderRadius: 20,
              background: 'oklch(78% 0.13 240 / 0.18)',
              color: ACCENT,
              border: '1px solid oklch(78% 0.13 240 / 0.3)',
            }}
          >
            {lockBranch}
          </div>
        ) : (
          pills.map((b) => {
            const active = branch === b;
            return (
              <div
                key={b}
                onClick={() => onBranch(b)}
                style={{
                  cursor: 'pointer',
                  font: "600 13.5px 'Inter'",
                  padding: '6px 13px',
                  borderRadius: 20,
                  background: active ? 'oklch(78% 0.13 240 / 0.18)' : t.bgCard,
                  color: active ? ACCENT : t.textMuted,
                  border: `1px solid ${active ? 'oklch(78% 0.13 240 / 0.3)' : t.borderLight}`,
                }}
              >
                {b === 'ALL' ? 'All' : b}
              </div>
            );
          })
        )}
      </div>

      <div style={{ flex: 1 }} />

      {onSearch && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.bgCard, border: `1px solid ${t.borderLight}`, borderRadius: 9, padding: '8px 12px', width: 240 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            value={search || ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            style={{ background: 'none', border: 'none', outline: 'none', color: t.text, font: "400 15px 'Inter'", width: '100%' }}
          />
        </div>
      )}
      {right}
    </div>
  );
}
