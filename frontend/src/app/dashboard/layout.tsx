'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRequireRole, useAuth } from '@/lib/auth';
import { ThemeProvider, useTheme } from '@/lib/ThemeProvider';
import { ACCENT, repColor } from '@/lib/theme';
import { api } from '@/lib/api';
import { NotificationHost } from '@/components/NotificationHost';
import { AppShell } from '@/components/AppShell';

const NAV = [
  { href: '/dashboard/requests', label: 'Requests', icon: 'M4 4h16v12H8l-4 4V4z' },
  { href: '/dashboard/receiving', label: 'Receive Shipments', icon: 'M3 7h11v10H3zM14 10h4l3 3v4h-7zM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  { href: '/dashboard/stock', label: 'Stock & Upload', icon: 'rect' },
  { href: '/dashboard/tracking', label: 'Given / Requested', icon: 'M5 19V9M12 19V5M19 19v-7' },
];

const ROSTER_LABELS: Record<string, string> = {
  Surbhi: 'Sales 0', Karan: 'Sales 1', Parth: 'Sales 2', Dhruvil: 'Sales 3', Harsh: 'Sales 4', Jash: 'Sales 5', Keyush: 'Sales 6',
  Fadi: 'Fadi', Parthik: 'Parthik', 'Parth (LA)': 'Sales 20',
  Romil: 'Sales 10', Ajay: 'Ajay', Sahil: 'Sales 21',
};
const ROSTER_BRANCHES = ['NY', 'LA', 'CH'];

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { logout } = useAuth();
  const { theme: t, name, toggle } = useTheme();
  const pathname = usePathname();
  const selectedRepId = useSearchParams().get('id');
  const [reps, setReps] = useState<{ id: number; name: string; branch: string }[]>([]);

  useEffect(() => {
    api.reps().then(setReps).catch(() => setReps([]));
  }, []);

  return (
    <>
    {/* Rendered outside the shell: inside the sidebar node it would unmount
        whenever the narrow-viewport drawer is closed, silently stopping
        notifications on a phone. */}
    <NotificationHost role="inventory" />
    <AppShell
      t={t}
      brand="Diamond ERP"
      pathname={pathname}
      /* Sidebar — scrolls on its own (overflowY + minHeight:0) so a tall
         nav/rep-roster at higher zoom never drags the main panel along
         with it or leaves blank space where the two got out of sync. */
      sidebarStyle={{ minHeight: 0, overflowY: 'auto', background: t.bgSide, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', padding: '18px 14px' }}
      sidebar={<>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 22px' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 16px 'Inter'", color: '#0a0e0d' }}>D</div>
          <div style={{ font: "700 16.5px 'Inter'", color: t.text }}>Diamond ERP</div>
        </div>
        <div style={{ font: "600 12px 'Inter'", color: t.textFainter, letterSpacing: '0.06em', padding: '6px 12px 8px' }}>INVENTORY SIDE</div>

        {NAV.map((item) => {
          const active = pathname === item.href;
          const fg = active ? ACCENT : t.textFaint;
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 9, marginBottom: 3, background: active ? 'oklch(78% 0.13 240 / 0.14)' : 'transparent' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="1.8">
                {item.icon === 'rect' ? (
                  <>
                    <rect x="3" y="7" width="18" height="13" rx="1.5" />
                    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </>
                ) : (
                  <path d={item.icon} />
                )}
              </svg>
              <span style={{ font: "600 15px 'Inter'", color: fg }}>{item.label}</span>
            </Link>
          );
        })}

        <div style={{ marginTop: 12, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reps.length > 0 && (
            <div style={{ padding: '10px 10px', borderRadius: 9, background: t.bgCard, border: `1px solid ${t.border}`, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <div style={{ font: "600 12px 'Inter'", color: t.textFainter, letterSpacing: '0.06em', marginBottom: 8 }}>SALES REPS</div>
              {ROSTER_BRANCHES.map((branch) => {
                const branchReps = reps.filter((rep) => rep.branch === branch).sort((a, b) => (ROSTER_LABELS[a.name] || a.name).localeCompare(ROSTER_LABELS[b.name] || b.name, undefined, { numeric: true }));
                if (!branchReps.length) return null;
                return <div key={branch} style={{ marginTop: 9 }}>
                  <div style={{ font: "700 11.5px 'Inter'", color: ACCENT, marginBottom: 4 }}>{branch}</div>
                  {branchReps.map((rep) => <Link key={rep.id} href={`/dashboard/reps?id=${rep.id}`} style={{ textDecoration: 'none', display: 'grid', gridTemplateColumns: '50px minmax(0,1fr)', alignItems: 'center', gap: 7, padding: '6px 5px', borderRadius: 6, background: pathname === '/dashboard/reps' && selectedRepId === String(rep.id) ? 'oklch(78% 0.13 240 / 0.14)' : 'transparent' }}>
                    <span style={{ font: "800 12px Arial, sans-serif", color: repColor(rep.name) }}>{ROSTER_LABELS[rep.name] || rep.name}</span>
                    <span style={{ font: "600 13px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rep.name}</span>
                  </Link>)}
                </div>;
              })}
            </div>
          )}
          <div style={{ padding: '4px 12px', font: "400 13px 'Inter'", color: t.textFainter }}>3 branches · NY · LA · CH</div>

          {/* Theme toggle */}
          <div onClick={toggle} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 9, background: t.bgCard, border: `1px solid ${t.border}` }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.textMuted} strokeWidth="1.8">
              {name === 'dark' ? <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
            </svg>
            <span style={{ font: "600 14px 'Inter'", color: t.textMuted }}>{name === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          </div>

          <div style={{ padding: '10px 12px', borderRadius: 9, background: t.bgCard, border: `1px solid ${t.border}` }}>
            <div style={{ font: "600 14px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
            <div style={{ font: "500 12.5px 'Inter'", color: ACCENT, marginTop: 2 }}>Inventory staff</div>
          </div>
          <button onClick={logout} style={{ padding: '9px 12px', borderRadius: 9, background: 'transparent', border: `1px solid ${t.border}`, color: t.textFaint, font: "600 13.5px 'Inter'", cursor: 'pointer', textAlign: 'left' }}>
            Sign out
          </button>
        </div>
      </>}
    >
      {children}
    </AppShell>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireRole('inventory');

  if (loading || !user) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e0d', color: 'oklch(60% 0.01 150)', font: "500 16px 'Inter', sans-serif" }}>Loading…</div>;
  }

  return (
    <ThemeProvider storageKey="dashboard_theme" defaultName="light">
      <Shell>{children}</Shell>
    </ThemeProvider>
  );
}
