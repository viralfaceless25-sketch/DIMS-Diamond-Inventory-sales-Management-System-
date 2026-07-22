'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, TrackingRow } from '@/lib/api';
import { useBranchSocket } from '@/lib/socket';
import { useTheme } from '@/lib/ThemeProvider';
import { TopBar } from '@/components/TopBar';
import { ACCENT, AMBER, BLUE } from '@/lib/theme';
import { TRACKING_LABELS } from '@/lib/utils';
import { Check } from '@/components/ui';

const STATUS_COLOR: Record<string, string> = {
  requested: 'oklch(55% 0.01 150)',
  partially_given: AMBER,
  with_rep: ACCENT,
  returned: BLUE,
};

export default function TrackingPage() {
  const { theme: t } = useTheme();
  const [branch, setBranch] = useState('ALL');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.tracking(branch, search, page);
    setRows(result.rows);
    setTotal(result.total);
    setLoading(false);
  }, [branch, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => { setPage(1); }, [branch, search]);

  useBranchSocket(branch, () => load());

  const cols = '1.2fr 1.1fr 60px 180px 40px 40px 40px minmax(0,1fr)';

  return (
    <>
      <TopBar title="Given / Requested" branch={branch} onBranch={setBranch} search={search} onSearch={setSearch} t={t} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 26 }}>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '11px 16px', font: "600 9.5px 'Inter'", color: t.textFainter, letterSpacing: '0.04em' }}>
            <div>STOCK #</div><div>REQUESTED BY</div><div>BRANCH</div><div>REQUESTED</div>
            <div title="Stone given">STN</div><div title="Cert given">CRT</div><div title="Returned">RET</div><div>STATUS</div>
          </div>
          {loading ? (
            <div style={{ padding: 44, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFainter }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 44, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFainter }}>No tracked stones yet.</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 16px', alignItems: 'center', borderTop: `1px solid ${t.rowBorder}` }}>
                <div style={{ font: "700 12px Arial, sans-serif", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.barcode}</div>
                <div style={{ font: "400 11.5px 'Inter'", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rep_name}</div>
                <div style={{ font: "600 11px Arial, sans-serif", color: t.textMuted }}>{r.branch}</div>
                <div style={{ font: "500 11px 'Inter'", color: t.textFaint }}>{new Date(r.requested_at).toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div>
                <Mark on={r.stone_found} t={t} />
                <Mark on={r.cert_found} t={t} />
                <Mark on={r.returned} blue t={t} />
                <div style={{ font: "600 10.5px 'Inter'", color: STATUS_COLOR[r.trackingStatus] }}>{TRACKING_LABELS[r.trackingStatus]}</div>
              </div>
            ))
          )}
        </div>
        {!loading && total > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, color: t.textMuted, font: "500 12px 'Inter'" }}>
          <span>{total.toLocaleString()} tracked stone{total === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} style={{ padding: '7px 11px', border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, borderRadius: 5, cursor: page === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
            <button onClick={() => setPage((value) => value + 1)} disabled={page * 100 >= total} style={{ padding: '7px 11px', border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, borderRadius: 5, cursor: page * 100 >= total ? 'not-allowed' : 'pointer' }}>Next</button>
          </div>
        </div>}
      </div>
    </>
  );
}

function Mark({ on, blue, t }: { on: boolean; blue?: boolean; t: import('@/lib/theme').Theme }) {
  return (
    <div style={{ display: 'flex' }}>
      {on ? (
        <Check checked size={16} accent={blue ? BLUE : ACCENT} disabled />
      ) : (
        <span style={{ font: "400 12px 'Inter'", color: t.textFainter }}>·</span>
      )}
    </div>
  );
}
