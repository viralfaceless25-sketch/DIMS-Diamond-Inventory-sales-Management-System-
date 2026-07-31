'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useRequireRole, useAuth } from '@/lib/auth';
import { THEMES, ThemeName, ACCENT, COLOR_ORDER, CLARITY_ORDER, initialsOf } from '@/lib/theme';
import { api } from '@/lib/api';
import { MiniDiamondSearch } from '@/components/MiniDiamondSearch';
import { ThemeContext, CartContext, StockFilterContext, QuickSearchContext } from './repContext';

// Theme context (light/dark) — Sales Rep app only, per the prototype.
const NAV = [
  { href: '/rep/request-stones', label: 'Request stones', icon: 'M4 4h16v12H8l-4 4V4z' },
  { href: '/rep/my-requests', label: 'My requests', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
  { href: '/rep/tracking', label: 'Stone tracking', icon: 'M3 12h4l3-8 4 16 3-8h4' },
];
const FALLBACK_SHAPES = [
  'Round', 'Oval', 'Cushion', 'Old Miner', 'Pear', 'Princess', 'Emerald', 'Marquise', 'Asscher', 'Radiant',
  'Heart', 'Baguette', 'Cushion Long', 'Cushion Modified Brilliant', 'Modified Shield Brilliant', 'Square Emerald',
  'Square Radiant', 'Tapper', 'Hexagonal', 'Octagonal', 'Triangular Brilliant', 'Trapezoid', 'Half Moon',
  'Round Mixed Cut', 'Portuguese', 'Moval', 'Cross T',
];

function toggleValue(values: string[], setValues: (values: string[]) => void, value: string) {
  setValues(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
}

export default function RepLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireRole('sales_rep');
  const { logout } = useAuth();
  const pathname = usePathname();
  const [name, setName] = useState<ThemeName>('light');
  const [cartCount, setCartCount] = useState(0);
  const [colors, setColors] = useState<string[]>([]);
  const [clarities, setClarities] = useState<string[]>([]);
  const [shapes, setShapes] = useState<string[]>([]);
  const [shapeOptions, setShapeOptions] = useState<string[]>(FALLBACK_SHAPES);
  const [shapePanelOpen, setShapePanelOpen] = useState(false);
  const [quickSearchTerm, setQuickSearchTerm] = useState('');

  const t = THEMES[name];
  const themeValue = useMemo(() => ({ theme: t, name, toggle: () => setName((n) => (n === 'dark' ? 'light' : 'dark')) }), [t, name]);

  useEffect(() => {
    api.stockOptions('ALL', 'loose')
      .then((options) => { if (options.shapes?.length) setShapeOptions(options.shapes); })
      .catch(() => setShapeOptions(FALLBACK_SHAPES));
  }, []);

  if (loading || !user) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e0d', color: '#888', font: "500 16px 'Inter'" }}>Loading…</div>;
  }

  return (
    <ThemeContext.Provider value={themeValue}>
      <CartContext.Provider value={{ count: cartCount, setCount: setCartCount }}>
        <StockFilterContext.Provider value={{ colors, setColors, clarities, setClarities, shapes, setShapes, shapeOptions }}>
        <QuickSearchContext.Provider value={{ term: quickSearchTerm, setTerm: setQuickSearchTerm }}>
        <div style={{ display: 'flex', width: '100%', height: '100vh', background: t.bg, color: t.text, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{ width: 224, flex: 'none', background: t.bgSide, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', padding: '18px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 18px' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 16px 'Inter'", color: '#0a0e0d' }}>D</div>
              <div style={{ font: "700 16.5px 'Inter'", color: t.text }}>Diamond ERP</div>
            </div>

            {/* Rep identity card */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', marginBottom: 12, background: t.bgCard, borderRadius: 10, border: `1px solid ${t.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 15px 'Inter'", color: '#0a0e0d', flex: 'none' }}>
                {initialsOf(user.name || user.email)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: "600 14.5px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name || user.email}</div>
                <div style={{ font: "500 12.5px 'Inter'", color: t.textFaint }}>Sales rep · {user.branch}</div>
              </div>
            </div>

            {/* Mini diamond search — quick stock lookup from any rep page */}
            <MiniDiamondSearch t={t} />

            {NAV.map((item) => {
              const active = pathname === item.href;
              const fg = active ? ACCENT : t.textFaint;
              const showBadge = item.href === '/rep/request-stones' && cartCount > 0;
              return (
                <Link key={item.href} href={item.href} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 9, marginBottom: 3, background: active ? 'oklch(78% 0.13 240 / 0.14)' : 'transparent' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="1.8"><path d={item.icon} /></svg>
                  <span style={{ font: "600 15px 'Inter'", color: fg }}>{item.label}</span>
                  {showBadge && <span style={{ marginLeft: 'auto', font: "700 12.5px 'JetBrains Mono'", background: 'oklch(75% 0.14 80)', color: '#0a0e0d', padding: '1px 7px', borderRadius: 9 }}>{cartCount}</span>}
                </Link>
              );
            })}

            {pathname === '/rep/request-stones' && (
              <div style={{ position: 'relative', margin: '12px 4px 0', paddingTop: 12, borderTop: `1px solid ${t.border}` }}>
                <div style={{ font: "700 12px 'Inter'", color: t.textFaint, letterSpacing: '0.05em', margin: '0 6px 9px' }}>FILTER STOCK</div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ font: "700 12.5px 'Inter'", color: t.textFaint, margin: '0 6px 5px' }}>Color</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                    {COLOR_ORDER.map((value) => <button key={value} onClick={() => toggleValue(colors, setColors, value)} style={{ border: `1px solid ${colors.includes(value) ? 'oklch(78% 0.13 240 / 0.35)' : 'transparent'}`, borderRadius: 5, padding: '5px 2px', cursor: 'pointer', background: colors.includes(value) ? 'oklch(78% 0.13 240 / 0.16)' : t.chipBg, color: colors.includes(value) ? ACCENT : t.textMuted, font: "700 12px Arial, sans-serif" }}>{value}</button>)}
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ font: "700 12.5px 'Inter'", color: t.textFaint, margin: '0 6px 5px' }}>Clarity</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                    {CLARITY_ORDER.map((value) => <button key={value} onClick={() => toggleValue(clarities, setClarities, value)} style={{ border: `1px solid ${clarities.includes(value) ? 'oklch(78% 0.13 240 / 0.35)' : 'transparent'}`, borderRadius: 5, padding: '5px 2px', cursor: 'pointer', background: clarities.includes(value) ? 'oklch(78% 0.13 240 / 0.16)' : t.chipBg, color: clarities.includes(value) ? ACCENT : t.textMuted, font: "700 12px Arial, sans-serif" }}>{value}</button>)}
                  </div>
                </div>
                <div>
                  <div style={{ font: "700 12.5px 'Inter'", color: t.textFaint, margin: '0 6px 5px' }}>Shape</div>
                  <button onClick={() => setShapePanelOpen((open) => !open)} style={{ width: '100%', border: `1px solid ${shapes.length ? 'oklch(78% 0.13 240 / 0.35)' : t.border}`, borderRadius: 6, padding: '7px 8px', cursor: 'pointer', background: shapes.length ? 'oklch(78% 0.13 240 / 0.12)' : t.bgCard, color: shapes.length ? ACCENT : t.textMuted, textAlign: 'left', font: "700 12.5px 'Inter'" }}>{shapes.length ? `${shapes.length} shape${shapes.length === 1 ? '' : 's'} selected` : 'Choose shapes'}</button>
                  {shapePanelOpen && <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, width: 500, marginTop: 8, padding: 12, border: `1px solid ${t.border}`, borderRadius: 8, background: t.bgCard, boxShadow: '0 12px 30px rgb(0 0 0 / 0.18)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}><span style={{ font: "700 13px 'Inter'", color: t.text }}>Shapes</span><button onClick={() => setShapes([])} style={{ border: 'none', background: 'transparent', color: t.textFaint, font: "600 12px 'Inter'", cursor: 'pointer' }}>Clear</button></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5 }}>{shapeOptions.map((value) => <button key={value} onClick={() => toggleValue(shapes, setShapes, value)} style={{ border: `1px solid ${shapes.includes(value) ? 'oklch(78% 0.13 240 / 0.35)' : t.border}`, borderRadius: 5, padding: '6px 5px', minHeight: 30, cursor: 'pointer', background: shapes.includes(value) ? 'oklch(78% 0.13 240 / 0.16)' : t.chipBg, color: shapes.includes(value) ? ACCENT : t.textMuted, font: "600 11.5px Arial, sans-serif", lineHeight: 1.1 }}>{value}</button>)}</div>
                  </div>}
                </div>
              </div>
            )}

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Theme toggle */}
              <div onClick={themeValue.toggle} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 9, background: t.bgCard, border: `1px solid ${t.border}` }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.textMuted} strokeWidth="1.8">
                  {name === 'dark' ? <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
                </svg>
                <span style={{ font: "600 14px 'Inter'", color: t.textMuted }}>{name === 'dark' ? 'Dark mode' : 'Light mode'}</span>
              </div>
              <button onClick={logout} style={{ padding: '9px 12px', borderRadius: 9, background: 'transparent', border: `1px solid ${t.border}`, color: t.textFaint, font: "600 13.5px 'Inter'", cursor: 'pointer', textAlign: 'left' }}>
                Sign out
              </button>
            </div>
          </div>

          {/* Main */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: t.bg }}>
            {children}
          </div>
        </div>
        </QuickSearchContext.Provider>
        </StockFilterContext.Provider>
      </CartContext.Provider>
    </ThemeContext.Provider>
  );
}
