'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, LooseStone } from '@/lib/api';
import { Theme, ACCENT } from '@/lib/theme';
import { availabilityText } from '@/lib/requestWorkflow';
import { fmtCarat } from '@/lib/utils';

// Compact always-on stock lookup for the sales-rep sidebar. Reps can find a
// diamond by stock number, certificate, or attributes from any rep page; a
// result jumps to the Request stones page with that term pre-filled so it can
// be added to a request. Reuses the same /api/stock/loose search the main
// grid uses, so results and availability stay consistent.
export function MiniDiamondSearch({ t }: { t: Theme }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LooseStone[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.looseStock({
          branch: 'ALL',
          search: term,
          page: 1,
          pageSize: 6,
          requestableOnly: false,
        });
        setRows(res.rows);
        setOpen(true);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function pick(stone: LooseStone) {
    setOpen(false);
    setQ('');
    router.push(`/rep/request-stones?q=${encodeURIComponent(stone.barcode)}`);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, padding: '8px 10px' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onFocus={() => { if (rows.length) setOpen(true); }}
          placeholder="Search diamonds"
          aria-label="Search diamonds"
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: t.text, font: "500 12px 'Inter'" }}
        />
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 6, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, boxShadow: '0 14px 34px rgb(0 0 0 / 0.22)', overflow: 'hidden', maxHeight: 328, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '10px 12px', font: "500 11px 'Inter'", color: t.textFaint }}>Searching…</div>}
          {!loading && rows.length === 0 && <div style={{ padding: '10px 12px', font: "500 11px 'Inter'", color: t.textFaint }}>No diamonds found.</div>}
          {rows.map((stone) => (
            <button
              key={stone.barcode}
              type="button"
              onClick={() => pick(stone)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderTop: `1px solid ${t.border}`, background: 'transparent', cursor: 'pointer', color: t.text }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span style={{ font: "700 11.5px 'Inter'" }}>{stone.barcode}</span>
                <span style={{ font: "700 9px 'Inter'", color: ACCENT }}>{stone.branch}</span>
              </div>
              <div style={{ font: "500 10px 'Inter'", color: t.textFaint, marginTop: 2 }}>
                {[stone.shape, stone.carat != null ? `${fmtCarat(stone.carat)}ct` : null, stone.color, stone.clarity].filter(Boolean).join(' · ') || '—'}
              </div>
              <div style={{ font: "600 9.5px 'Inter'", color: t.textMuted, marginTop: 2 }}>{availabilityText(stone.availability)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
