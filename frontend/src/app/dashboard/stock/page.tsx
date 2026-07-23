'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, LooseStone, JewelryPiece } from '@/lib/api';
import { useBranchSocket } from '@/lib/socket';
import { useTheme } from '@/lib/ThemeProvider';
import { TopBar } from '@/components/TopBar';
import { ACCENT, AMBER, RED, COLOR_ORDER, CLARITY_ORDER } from '@/lib/theme';
import { fmtCarat, fmtMeasurements } from '@/lib/utils';

type ItemType = 'loose' | 'jewelry';
const PAGE_SIZE = 50;

export default function StockPage() {
  const { theme: t } = useTheme();
  const [branch, setBranch] = useState<string>('NY');
  const [itemType, setItemType] = useState<ItemType>('loose');
  const [loose, setLoose] = useState<LooseStone[]>([]);
  const [jewelry, setJewelry] = useState<JewelryPiece[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [barcodeQ, setBarcodeQ] = useState('');
  const [certQ, setCertQ] = useState('');
  const [refQ, setRefQ] = useState('');
  const [shapes, setShapes] = useState<string[]>([]);
  const [labs, setLabs] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [metals, setMetals] = useState<string[]>([]);
  const [goldColors, setGoldColors] = useState<string[]>([]);
  const [purities, setPurities] = useState<string[]>([]);
  const [shapeOptions, setShapeOptions] = useState<string[]>([]);
  const [labOptions, setLabOptions] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [metalOptions, setMetalOptions] = useState<string[]>([]);
  const [caratMin, setCaratMin] = useState('');
  const [caratMax, setCaratMax] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [clarities, setClarities] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadErr, setUploadErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = {
      branch,
      page,
      pageSize: PAGE_SIZE,
      barcode: barcodeQ || undefined,
      cert: certQ || undefined,
      ref: itemType === 'jewelry' ? refQ || undefined : undefined,
      shapes,
      labs,
      categories,
      metals,
      goldColors,
      purities,
      caratMin: caratMin || undefined,
      caratMax: caratMax || undefined,
      colors: itemType === 'loose' ? colors : [],
      clarities: itemType === 'loose' ? clarities : [],
      statuses,
    };
    if (itemType === 'loose') {
      const res = await api.looseStock(q);
      setLoose(res.rows);
      setTotal(res.total);
    } else {
      const res = await api.jewelryStock(q);
      setJewelry(res.rows);
      setTotal(res.total);
    }
    setLoading(false);
  }, [branch, itemType, page, barcodeQ, certQ, refQ, shapes, labs, categories, metals, goldColors, purities, caratMin, caratMax, colors, clarities, statuses]);

  useEffect(() => {
    load();
  }, [load]);

  const loadOptions = useCallback(async () => {
    try {
      const opts = await api.stockOptions(branch, itemType);
      setShapeOptions(opts.shapes || []);
      setLabOptions(opts.labs || []);
      setCategoryOptions(opts.categories || []);
      setMetalOptions(opts.metals || []);
    } catch {
      setShapeOptions([]);
      setLabOptions([]);
      setCategoryOptions([]);
      setMetalOptions([]);
    }
  }, [branch, itemType]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  // Reset to page 1 when branch / type / filters change.
  useEffect(() => {
    setPage(1);
  }, [branch, itemType, barcodeQ, certQ, refQ, shapes, labs, categories, metals, goldColors, purities, caratMin, caratMax, colors, clarities, statuses]);

  useEffect(() => {
    setShapes([]);
    setLabs([]);
    setCategories([]);
    setMetals([]);
    setGoldColors([]);
    setPurities([]);
    setColors([]);
    setClarities([]);
  }, [itemType]);

  // Live refresh: a completed upload (or request change) refetches the page.
  useBranchSocket(branch === 'ALL' ? 'ALL' : branch, (ev) => {
    if (ev === 'stock:updated' || ev.startsWith('request:')) load();
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('Processing stock file securely… large files can take a minute. You can keep the app open.');
    setUploadErr('');
    try {
      const res = await api.uploadStock(file);
      const skipped = res.skippedBranches.length ? ` (skipped: ${res.skippedBranches.join(', ')})` : '';
      setUploadMsg(`Imported ${res.rowsImported.toLocaleString()} ${res.format} rows into ${res.branchesUpdated.join(', ')}${skipped}.`);
      // Jump to the first branch that was updated so the result is visible immediately.
      if (res.branchesUpdated.length && !res.branchesUpdated.includes(branch)) {
        setBranch(res.branchesUpdated[0]);
      } else {
        setPage(1);
        load();
        loadOptions();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadErr(
        message === 'Failed to fetch'
          ? 'The server connection was interrupted. Your existing stock was not replaced; wait a moment and upload the file again.'
          : message
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(barcodeQ || certQ || refQ || shapes.length || labs.length || categories.length || metals.length || goldColors.length || purities.length || caratMin || caratMax || colors.length || clarities.length || statuses.length);
  const jewelryGoldOptions = metalOptions.length
    ? [
        metalOptions.some((m) => /\bYG\b|YELLOW/i.test(m)) ? 'Yellow' : null,
        metalOptions.some((m) => /\bWG\b|WHITE/i.test(m)) ? 'White' : null,
        metalOptions.some((m) => /\b(PG|RG)\b|PINK|ROSE/i.test(m)) ? 'Pink' : null,
      ].filter(Boolean) as string[]
    : ['Yellow', 'White', 'Pink'];
  const jewelryPurityOptions = metalOptions.length
    ? [...new Set(metalOptions.map((m) => String(m).match(/(\d{1,2})K/i)?.[1]).filter(Boolean) as string[])].sort((a, b) => Number(b) - Number(a))
    : ['22', '18', '14', '10', '9'];
  const clearFilters = () => {
    setBarcodeQ('');
    setCertQ('');
    setRefQ('');
    setShapes([]);
    setLabs([]);
    setCategories([]);
    setMetals([]);
    setGoldColors([]);
    setPurities([]);
    setCaratMin('');
    setCaratMax('');
    setColors([]);
    setClarities([]);
    setStatuses([]);
  };

  return (
    <>
      <TopBar title="Stock & Upload" branch={branch} onBranch={setBranch} t={t} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 26 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <TabBtn active={itemType === 'loose'} onClick={() => setItemType('loose')} t={t}>Loose diamonds</TabBtn>
          <TabBtn active={itemType === 'jewelry'} onClick={() => setItemType('jewelry')} t={t}>Jewelry pieces</TabBtn>
        </div>

        {/* Mini diamond search — live filter by barcode and/or certificate no. */}
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <div style={{ font: "700 13px 'Inter'", color: t.text }}>Diamond search</div>
            <div style={{ font: "400 11px 'Inter'", color: t.textFaint }}>{itemType === 'loose' ? 'find by barcode, certificate, shape, lab, size, color, clarity, or status' : 'find by barcode, cert, category, metal, lab, diamond cts, or status'}</div>
            {hasFilters && (
              <button onClick={clearFilters} style={{ marginLeft: 'auto', font: "600 11px 'Inter'", color: t.textFaint, background: 'transparent', border: `1px solid ${t.borderLight}`, borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>Clear</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', font: "600 10px 'Inter'", color: t.textFaint, marginBottom: 5, letterSpacing: '0.03em' }}>BARCODE</label>
              <input value={barcodeQ} onChange={(e) => setBarcodeQ(e.target.value)} placeholder="e.g. 268140-003A" style={{ width: '100%', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 8, padding: '9px 12px', color: t.text, font: "500 12.5px 'JetBrains Mono'", outline: 'none' }} />
            </div>
            {itemType === 'jewelry' && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: 'block', font: "600 10px 'Inter'", color: t.textFaint, marginBottom: 5, letterSpacing: '0.03em' }}>REF NO.</label>
                <input value={refQ} onChange={(e) => setRefQ(e.target.value)} placeholder="e.g. J103453" style={{ width: '100%', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 8, padding: '9px 12px', color: t.text, font: "500 12.5px 'JetBrains Mono'", outline: 'none' }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', font: "600 10px 'Inter'", color: t.textFaint, marginBottom: 5, letterSpacing: '0.03em' }}>{itemType === 'loose' ? 'CERTIFICATE NO.' : 'CERT NO.'}</label>
              <input value={certQ} onChange={(e) => setCertQ(e.target.value)} placeholder="e.g. 749533545" style={{ width: '100%', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 8, padding: '9px 12px', color: t.text, font: "500 12.5px 'JetBrains Mono'", outline: 'none' }} />
            </div>
          </div>
        </div>

        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ font: "700 13px 'Inter'", color: t.text, marginBottom: 12 }}>{itemType === 'loose' ? 'More diamond filters' : 'Jewelry filters'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(150px, 1fr))', gap: 12 }}>
            <SearchInput label={itemType === 'loose' ? 'MIN CT' : 'MIN D.CTS'} value={caratMin} onChange={setCaratMin} placeholder="0.50" t={t} mono />
            <SearchInput label={itemType === 'loose' ? 'MAX CT' : 'MAX D.CTS'} value={caratMax} onChange={setCaratMax} placeholder="2.00" t={t} mono />
          </div>
          {itemType === 'loose' ? (
            <>
              <ChipRow label="Shape" values={shapeOptions} active={shapes} onToggle={(v) => setShapes((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
              <ChipRow label="Lab" values={labOptions} active={labs} onToggle={(v) => setLabs((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
              <ChipRow label="Color" values={COLOR_ORDER} active={colors} onToggle={(v) => setColors((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
              <ChipRow label="Clarity" values={CLARITY_ORDER} active={clarities} onToggle={(v) => setClarities((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
            </>
          ) : (
            <>
              <ChipRow label="Gold" values={jewelryGoldOptions} active={goldColors} onToggle={(v) => setGoldColors((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
              <ChipRow label="Purity" values={jewelryPurityOptions} labels={{ '22': '22K', '18': '18K', '14': '14K', '10': '10K', '9': '9K' }} active={purities} onToggle={(v) => setPurities((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
              <ChipRow label="Category" values={categoryOptions} active={categories} onToggle={(v) => setCategories((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} wide />
              <ChipRow label="Metal" values={metalOptions} active={metals} onToggle={(v) => setMetals((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} wide />
              <ChipRow label="Lab" values={labOptions} active={labs} onToggle={(v) => setLabs((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
            </>
          )}
          <ChipRow label="Status" values={['available', 'on_memo', 'on_hold', 'in_transit']} labels={{ available: 'Available', on_memo: 'On Memo', on_hold: 'On Hold', in_transit: 'In Transit' }} active={statuses} onToggle={(v) => setStatuses((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} t={t} />
        </div>

        {/* Upload box */}
        <div style={{ background: t.bgCard, border: `1px dashed ${t.borderLight}`, borderRadius: 12, padding: 20, marginBottom: 22, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13px 'Inter'", color: t.text }}>Upload stock spreadsheet</div>
            <div style={{ font: "400 11.5px 'Inter'", color: t.textFaint, marginTop: 3 }}>
              .xlsx or .csv for both loose stones and jewelry. Rows are grouped by their Branch column; each included branch is replaced atomically.
            </div>
            {uploadMsg && <div style={{ marginTop: 8, font: "500 11.5px 'Inter'", color: ACCENT }}>{uploadMsg}</div>}
            {uploadErr && <div style={{ marginTop: 8, font: "500 11.5px 'Inter'", color: RED }}>{uploadErr}</div>}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={onFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', background: uploading ? t.chipBg : ACCENT, color: uploading ? t.textFaint : '#0a0e0d', font: "600 12.5px 'Inter'", cursor: uploading ? 'default' : 'pointer', flex: 'none' }}>
            {uploading ? 'Processing…' : 'Choose file'}
          </button>
        </div>

        {/* Result count + pagination header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ font: "500 12px 'Inter'", color: t.textFaint }}>
            {loading ? 'Loading…' : `${total.toLocaleString()} ${itemType === 'loose' ? 'stones' : 'pieces'}${hasFilters ? ' matching' : ''}`}
          </div>
          <Pager page={page} totalPages={totalPages} onPage={setPage} t={t} />
        </div>

        {itemType === 'loose' ? <LooseTable rows={loose} t={t} loading={loading} /> : <JewelryTable rows={jewelry} t={t} loading={loading} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <Pager page={page} totalPages={totalPages} onPage={setPage} t={t} />
        </div>
      </div>
    </>
  );
}

function availabilityLabel(a: LooseStone['availability']) {
  if (a.label && a.status !== 'requested') {
    return { text: a.label, color: a.status === 'on_hold' ? RED : a.status === 'on_memo' ? AMBER : ACCENT };
  }
  if (a.status === 'in_stock') return { text: 'In stock', color: ACCENT };
  if (a.status === 'conflict') return { text: `${a.repCount} reps — conflict`, color: RED };
  if (a.status === 'on_memo') return { text: 'On Memo', color: AMBER };
  if (a.status === 'on_hold') return { text: 'On Hold', color: RED };
  if (a.status === 'in_transit') return { text: 'In Transit', color: AMBER };
  return { text: `Requested · ${a.repName}`, color: AMBER };
}

function LooseTable({ rows, t, loading }: { rows: LooseStone[]; t: import('@/lib/theme').Theme; loading: boolean }) {
  if (loading) return <Empty t={t}>Loading…</Empty>;
  if (rows.length === 0) return <Empty t={t}>No stock here. Upload a spreadsheet to populate it.</Empty>;
  const cols = '1.15fr 90px 70px minmax(165px,1.15fr) 130px 60px 70px 1fr minmax(0,1.2fr)';
  return (
    <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 16px', font: "600 9.5px 'Inter'", color: t.textFainter }}>
        <div>BARCODE</div><div>SHAPE</div><div>CARAT</div><div>MEASUREMENTS / RATIO</div><div>COLOR</div><div>CLTY</div><div>LAB</div><div>CERT #</div><div>AVAILABILITY</div>
      </div>
      {rows.map((r) => {
        const av = availabilityLabel(r.availability);
        return (
          <div key={r.barcode} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 16px', alignItems: 'center', borderTop: `1px solid ${t.rowBorder}` }}>
            <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.barcode}</div>
            <div style={{ font: "400 11.5px 'Inter'", color: t.textMuted }}>{r.shape || '—'}</div>
            <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>{fmtCarat(r.carat)}</div>
            <div style={{ font: "600 11px Arial, sans-serif", color: t.textMuted, whiteSpace: 'nowrap' }}>{fmtMeasurements(r.length_mm, r.width_mm, r.height_mm, r.lw_ratio)}</div>
            <div style={{ font: "400 11px 'Inter'", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.color || ''}>{r.color || '—'}</div>
            <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text }}>{r.clarity || '—'}</div>
            <div style={{ font: "400 11px 'Inter'", color: t.textMuted }}>{r.lab || '—'}</div>
            <div style={{ font: "500 11px 'JetBrains Mono'", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.certificate_no || '—'}</div>
            <div style={{ font: "600 10.5px 'Inter'", color: av.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{av.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function JewelryTable({ rows, t, loading }: { rows: JewelryPiece[]; t: import('@/lib/theme').Theme; loading: boolean }) {
  if (loading) return <Empty t={t}>Loading…</Empty>;
  if (rows.length === 0) return <Empty t={t}>No jewelry here. Upload a spreadsheet to populate it.</Empty>;
  const cols = '1fr 80px minmax(0,1.4fr) 80px 80px 70px 58px 70px minmax(0,1.1fr)';
  return (
    <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 16px', font: "600 9.5px 'Inter'", color: t.textFainter }}>
        <div>BARCODE</div><div>CATEGORY</div><div>ITEM</div><div>REF #</div><div>METAL</div><div>D.CTS</div><div>PCS</div><div>AMOUNT</div><div>AVAILABILITY</div>
      </div>
      {rows.map((r) => {
        const av = availabilityLabel(r.availability);
        return (
          <div key={r.barcode} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 16px', alignItems: 'center', borderTop: `1px solid ${t.rowBorder}` }}>
            <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.barcode}</div>
            <div style={{ font: "400 11.5px 'Inter'", color: t.textMuted }}>{r.category || '—'}</div>
            <div style={{ font: "400 11.5px 'Inter'", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item || '—'}</div>
            <div style={{ font: "500 11px 'JetBrains Mono'", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ref_no || '—'}</div>
            <div style={{ font: "400 11.5px 'Inter'", color: t.textMuted }}>{r.metal || '—'}</div>
            <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>{r.diamond_cts ?? '—'}</div>
            <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>{r.diamond_pcs ?? '—'}</div>
            <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>{r.amount ?? '—'}</div>
            <div style={{ font: "600 10.5px 'Inter'", color: av.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{av.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function Pager({ page, totalPages, onPage, t }: { page: number; totalPages: number; onPage: (p: number) => void; t: import('@/lib/theme').Theme }) {
  if (totalPages <= 1) return null;
  const btn = (label: string, target: number, disabled: boolean) => (
    <button onClick={() => !disabled && onPage(target)} disabled={disabled} style={{ padding: '6px 11px', borderRadius: 7, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: disabled ? t.textFainter : t.textMuted, font: "600 11px 'Inter'", cursor: disabled ? 'default' : 'pointer' }}>{label}</button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {btn('‹ Prev', page - 1, page <= 1)}
      <span style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textFaint, padding: '0 6px' }}>{page} / {totalPages}</span>
      {btn('Next ›', page + 1, page >= totalPages)}
    </div>
  );
}

function TabBtn({ active, onClick, children, t }: { active: boolean; onClick: () => void; children: React.ReactNode; t: import('@/lib/theme').Theme }) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', font: "600 12.5px 'Inter'", padding: '8px 16px', borderRadius: 9, background: active ? 'oklch(78% 0.13 240 / 0.15)' : t.bgCard, color: active ? ACCENT : t.textMuted, border: `1px solid ${active ? 'oklch(78% 0.13 240 / 0.3)' : t.border}` }}>
      {children}
    </div>
  );
}

function SearchInput({ label, value, onChange, placeholder, t, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; t: import('@/lib/theme').Theme; mono?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={{ display: 'block', font: "600 10px 'Inter'", color: t.textFaint, marginBottom: 5, letterSpacing: '0.03em' }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ width: '100%', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 8, padding: '9px 12px', color: t.text, font: `500 12.5px '${mono ? 'JetBrains Mono' : 'Inter'}'`, outline: 'none' }} />
    </div>
  );
}

function ChipRow({ label, values, labels, active, onToggle, t, wide }: { label: string; values: string[]; labels?: Record<string, string>; active: string[]; onToggle: (v: string) => void; t: import('@/lib/theme').Theme; wide?: boolean }) {
  if (values.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <span style={{ font: "600 10.5px 'Inter'", color: t.textFaint, width: wide ? 70 : 48 }}>{label}</span>
      {values.map((v) => {
        const on = active.includes(v);
        return (
          <button key={v} onClick={() => onToggle(v)} style={{ cursor: 'pointer', font: "600 11px 'Inter'", padding: '5px 11px', borderRadius: 20, background: on ? 'oklch(78% 0.13 240 / 0.18)' : t.chipBg, color: on ? ACCENT : t.textMuted, border: `1px solid ${on ? 'oklch(78% 0.13 240 / 0.3)' : 'transparent'}` }}>
            {labels?.[v] || v}
          </button>
        );
      })}
    </div>
  );
}

function Empty({ children, t }: { children: React.ReactNode; t: import('@/lib/theme').Theme }) {
  return <div style={{ padding: 50, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFaint, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12 }}>{children}</div>;
}
