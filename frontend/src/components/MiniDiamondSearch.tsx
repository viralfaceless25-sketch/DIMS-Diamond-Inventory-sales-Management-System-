'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, LooseStone } from '@/lib/api';
import { Theme, ACCENT, COLOR_ORDER, CLARITY_ORDER } from '@/lib/theme';
import { availabilityText } from '@/lib/requestWorkflow';
import { Copyable } from '@/components/ui';
import { fmtCarat, extractBarcodes } from '@/lib/utils';
import { useQuickSearch, useStockFilters } from '@/app/rep/repContext';

const CERT_VALUES = ['certified', 'non_cert'];
const CERT_LABELS: Record<string, string> = { certified: 'Certified', non_cert: 'Non-cert' };

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

// Compact chip-row filter control for the mini search's own filter panel —
// a smaller sibling of dashboard/stock's ChipRow, sized for the sidebar.
function MiniChipRow({ label, values, labels, active, onToggle, t }: { label: string; values: string[]; labels?: Record<string, string>; active: string[]; onToggle: (v: string) => void; t: Theme }) {
  if (values.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ font: "600 11px 'Inter'", color: t.textFaint, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 84, overflowY: 'auto' }}>
        {values.map((v) => {
          const on = active.includes(v);
          return (
            <button key={v} type="button" onClick={() => onToggle(v)} style={{ cursor: 'pointer', font: "600 11px 'Inter'", padding: '3px 8px', borderRadius: 20, background: on ? 'oklch(78% 0.13 240 / 0.18)' : t.chipBg, color: on ? ACCENT : t.textMuted, border: `1px solid ${on ? 'oklch(78% 0.13 240 / 0.3)' : 'transparent'}` }}>
              {labels?.[v] || v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Compact always-on stock lookup for the sales-rep sidebar. Reps can find a
// diamond by stock number, certificate, or attributes from any rep page; a
// result jumps to the Request stones page with that term pre-filled so it can
// be added to a request. Reuses the same /api/stock/loose search the main
// grid uses, so results and availability stay consistent.
export function MiniDiamondSearch({ t }: { t: Theme }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setTerm } = useQuickSearch();
  const { shapeOptions } = useStockFilters();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LooseStone[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [labOptions, setLabOptions] = useState<string[]>([]);
  const [shapes, setShapes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [clarities, setClarities] = useState<string[]>([]);
  const [labs, setLabs] = useState<string[]>([]);
  const [certStatuses, setCertStatuses] = useState<string[]>([]);
  const [caratMin, setCaratMin] = useState('');
  const [caratMax, setCaratMax] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const searchGenerationRef = useRef(0);

  const hasFilters = !!(shapes.length || colors.length || clarities.length || labs.length || certStatuses.length || caratMin || caratMax);

  useEffect(() => {
    let active = true;
    api.stockOptions('ALL', 'loose')
      .then((options) => { if (active) setLabOptions(options.labs || []); })
      .catch(() => { if (active) setLabOptions([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      searchGenerationRef.current += 1;
    };
  }, []);

  function clearFilters() {
    setShapes([]);
    setColors([]);
    setClarities([]);
    setLabs([]);
    setCertStatuses([]);
    setCaratMin('');
    setCaratMax('');
  }

  useEffect(() => {
    const generation = ++searchGenerationRef.current;
    const isCurrent = () => mountedRef.current && searchGenerationRef.current === generation;
    const term = q.trim();
    if (term.length < 2 && !hasFilters) {
      setRows([]);
      setLoading(false);
      if (!filtersOpen) setOpen(false);
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
          if (!isCurrent()) return;
          setRows(results.filter((row): row is LooseStone => Boolean(row)));
          setOpen(true);
          return;
        }
        const res = await api.looseStock({
          branch: 'ALL',
          search: term || undefined,
          shapes,
          colors,
          clarities,
          labs,
          certStatuses,
          caratMin: caratMin || undefined,
          caratMax: caratMax || undefined,
          page: 1,
          pageSize: 6,
          requestableOnly: false,
        });
        if (!isCurrent()) return;
        setRows(res.rows);
        setOpen(true);
      } catch {
        if (isCurrent()) setRows([]);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, shapes, colors, clarities, labs, certStatuses, caratMin, caratMax, hasFilters, filtersOpen]);

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

  const filterCount = shapes.length + colors.length + clarities.length + labs.length + certStatuses.length + (caratMin ? 1 : 0) + (caratMax ? 1 : 0);

  return (
    <div ref={boxRef} style={{ position: 'relative', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, padding: '8px 10px' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onFocus={() => { if (rows.length || hasFilters) setOpen(true); }}
          placeholder="Search diamonds"
          aria-label="Search diamonds"
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: t.text, font: "500 14px 'Inter'" }}
        />
        <button
          type="button"
          onClick={() => { setFiltersOpen((v) => !v); setOpen(true); }}
          aria-label="Diamond filters"
          style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, flex: 'none', border: 'none', background: 'none', cursor: 'pointer', color: filterCount ? ACCENT : t.textFaint }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16M7 12h10M10 19h4" /></svg>
          {filterCount > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 13, height: 13, borderRadius: 7, background: ACCENT, color: '#0a0e0d', font: "700 9px 'Inter'", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px' }}>{filterCount}</span>}
        </button>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, width: 296, marginTop: 6, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, boxShadow: '0 14px 34px rgb(0 0 0 / 0.22)', overflow: 'hidden', maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
          {filtersOpen && (
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}`, overflowY: 'auto', maxHeight: 260, flex: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ font: "700 12px 'Inter'", color: t.text }}>Filters</span>
                {hasFilters && <button type="button" onClick={clearFilters} style={{ border: 'none', background: 'transparent', color: t.textFaint, font: "600 11px 'Inter'", cursor: 'pointer' }}>Clear</button>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ font: "600 11px 'Inter'", color: t.textFaint, marginBottom: 4 }}>Min ct</div>
                  <input value={caratMin} onChange={(e) => setCaratMin(e.target.value)} placeholder="0.50" style={{ width: '100%', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 6, padding: '5px 7px', color: t.text, font: "500 11.5px 'JetBrains Mono'", outline: 'none' }} />
                </div>
                <div>
                  <div style={{ font: "600 11px 'Inter'", color: t.textFaint, marginBottom: 4 }}>Max ct</div>
                  <input value={caratMax} onChange={(e) => setCaratMax(e.target.value)} placeholder="2.00" style={{ width: '100%', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 6, padding: '5px 7px', color: t.text, font: "500 11.5px 'JetBrains Mono'", outline: 'none' }} />
                </div>
              </div>
              <MiniChipRow label="Shape" values={shapeOptions} active={shapes} onToggle={(v) => setShapes(toggle(shapes, v))} t={t} />
              <MiniChipRow label="Color" values={COLOR_ORDER} active={colors} onToggle={(v) => setColors(toggle(colors, v))} t={t} />
              <MiniChipRow label="Clarity" values={CLARITY_ORDER} active={clarities} onToggle={(v) => setClarities(toggle(clarities, v))} t={t} />
              <MiniChipRow label="Lab" values={labOptions} active={labs} onToggle={(v) => setLabs(toggle(labs, v))} t={t} />
              <MiniChipRow label="Certificate" values={CERT_VALUES} labels={CERT_LABELS} active={certStatuses} onToggle={(v) => setCertStatuses(toggle(certStatuses, v))} t={t} />
            </div>
          )}
          <div style={{ overflowY: 'auto' }}>
            {loading && <div style={{ padding: '10px 12px', font: "500 13px 'Inter'", color: t.textFaint }}>Searching…</div>}
            {!loading && rows.length === 0 && (
              <div style={{ padding: '10px 12px', font: "500 13px 'Inter'", color: t.textFaint }}>
                {q.trim().length < 2 && !hasFilters ? 'Type at least 2 characters or pick a filter.' : 'No diamonds found.'}
              </div>
            )}
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
                <div style={{ font: "500 11px 'Inter'", color: t.textFaint, marginTop: 2 }}>
                  {stone.certificate_no ? `${stone.lab || 'Cert'} ${stone.certificate_no}` : 'Non-cert'}
                </div>
                <div style={{ font: "600 11.5px 'Inter'", color: t.textMuted, marginTop: 2 }}>{availabilityText(stone.availability)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
