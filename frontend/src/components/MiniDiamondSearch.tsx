'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, LooseStone } from '@/lib/api';
import { Theme, ACCENT } from '@/lib/theme';
import { availabilityText } from '@/lib/requestWorkflow';
import { Copyable } from '@/components/ui';
import { fmtCarat, extractBarcodes } from '@/lib/utils';
import { useQuickSearch } from '@/app/rep/repContext';

// Compact always-on stock lookup for the sales-rep sidebar. Reps can find a
// diamond by stock number, certificate, or attributes from any rep page; a
// result jumps to the Request stones page with that term pre-filled so it can
// be added to a request. Reuses the same /api/stock/loose search the main
// grid uses, so results and availability stay consistent.
export function MiniDiamondSearch({ t }: { t: Theme }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setTerm } = useQuickSearch();
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
        // A paste with 2+ recognized Maitri barcodes is a batch lookup, not
        // one fuzzy search term — the backend only matches a single search
        // string, so look each barcode up individually and merge the results.
        const barcodes = extractBarcodes(term);
        if (barcodes.length > 1) {
          const results = await Promise.all(
            barcodes.slice(0, 10).map((code) =>
              api.looseStock({ branch: 'ALL', search: code, page: 1, pageSize: 1, requestableOnly: false })
                .then((res) => res.rows.find((row) => row.barcode.toUpperCase() === code) || null)
                .catch(() => null)
            )
          );
          setRows(results.filter((row): row is LooseStone => Boolean(row)));
          setOpen(true);
          return;
        }
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
    if (pathname === '/rep/request-stones') {
      // Already there — update the shared search term directly. A
      // router.push to the same route (query string only) still triggers a
      // full Next.js navigation, which was observed to make the layout's
      // pathname-gated FILTER STOCK panel flicker.
      setTerm(stone.barcode);
    } else {
      router.push(`/rep/request-stones?q=${encodeURIComponent(stone.barcode)}`);
    }
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
          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: t.text, font: "500 14px 'Inter'" }}
        />
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 6, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, boxShadow: '0 14px 34px rgb(0 0 0 / 0.22)', overflow: 'hidden', maxHeight: 328, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '10px 12px', font: "500 13px 'Inter'", color: t.textFaint }}>Searching…</div>}
          {!loading && rows.length === 0 && <div style={{ padding: '10px 12px', font: "500 13px 'Inter'", color: t.textFaint }}>No diamonds found.</div>}
          {rows.map((stone) => (
            <button
              key={stone.barcode}
              type="button"
              onClick={() => pick(stone)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderTop: `1px solid ${t.border}`, background: 'transparent', cursor: 'pointer', color: t.text }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <Copyable value={stone.barcode} style={{ font: "700 13.5px 'Inter'" }} />
                <span style={{ font: "700 11px 'Inter'", color: ACCENT }}>{stone.branch}</span>
              </div>
              <div style={{ font: "500 12px 'Inter'", color: t.textFaint, marginTop: 2 }}>
                {[stone.shape, stone.carat != null ? `${fmtCarat(stone.carat)}ct` : null, stone.color, stone.clarity].filter(Boolean).join(' · ') || '—'}
              </div>
              <div style={{ font: "600 11.5px 'Inter'", color: t.textMuted, marginTop: 2 }}>{availabilityText(stone.availability)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
