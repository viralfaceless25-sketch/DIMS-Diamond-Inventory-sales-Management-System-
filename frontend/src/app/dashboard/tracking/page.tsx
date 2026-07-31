'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, TrackingRow } from '@/lib/api';
import { useBranchSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/ThemeProvider';
import { TopBar } from '@/components/TopBar';
import { Copyable } from '@/components/ui';
import { ACCENT, AMBER, BLUE, GREEN, RED } from '@/lib/theme';
import { TRACKING_LABELS } from '@/lib/utils';

const STATUS_COLOR: Record<string, string> = {
  requested: 'oklch(55% 0.01 150)',
  partially_given: AMBER,
  with_rep: ACCENT,
  returned: BLUE,
};

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TrackingPage() {
  const { theme: t } = useTheme();
  const { user } = useAuth();
  // Inventory staff only ever track their own branch; the server enforces this.
  const [branch, setBranch] = useState(user?.branch || 'ALL');
  // Two dedicated fields instead of one ambiguous "rep, stock#, or cert#"
  // box — the backend only takes a single search term, so whichever of the
  // two is filled becomes that term (barcode wins if both are).
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [certSearch, setCertSearch] = useState('');
  const search = barcodeSearch.trim() || certSearch.trim();
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.tracking(branch, search, page);
      setRows(result.rows);
      setTotal(result.total);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not load stone tracking.');
    } finally {
      setLoading(false);
    }
  }, [branch, search, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [branch, search]);
  useEffect(() => {
    if (user?.branch && user.branch !== branch) setBranch(user.branch);
  }, [user?.branch, branch]);
  useBranchSocket(branch, () => load());

  const summaryCols = 'minmax(150px,1.2fr) minmax(115px,1fr) minmax(130px,1fr) 80px 90px minmax(130px,1fr) 110px 32px';

  return (
    <>
      <TopBar title="Stone movement history" branch={branch} onBranch={setBranch} lockBranch={user?.branch || undefined} t={t} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 26 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, padding: '9px 12px', minWidth: 220, flex: '1 1 220px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input
              value={barcodeSearch}
              onChange={(event) => setBarcodeSearch(event.target.value)}
              placeholder="Search by barcode"
              autoComplete="off"
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: t.text, font: "500 12.5px 'Inter'" }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, padding: '9px 12px', minWidth: 220, flex: '1 1 220px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input
              value={certSearch}
              onChange={(event) => setCertSearch(event.target.value)}
              placeholder="Search by certificate number"
              autoComplete="off"
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: t.text, font: "500 12.5px 'Inter'" }}
            />
          </div>
        </div>

        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: summaryCols, gap: 10, padding: '11px 16px', minWidth: 980, font: "700 9.5px 'Inter'", color: t.textFainter, letterSpacing: '0.04em' }}>
            <div>BARCODE</div><div>CERTIFICATE</div><div>REQUESTED BY</div><div>HOME</div>
            <div>CURRENT</div><div>STATUS</div><div>LAST MOVEMENT</div><div />
          </div>

          {loading ? (
            <div style={{ padding: 44, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFainter }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 44, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFainter }}>No stone movements match these filters.</div>
          ) : rows.map((row) => {
            const open = expanded[row.id];
            const latest = row.movements[0];
            return (
              <div key={row.id} style={{ borderTop: `1px solid ${t.rowBorder}` }}>
                <button
                  onClick={() => setExpanded((current) => ({ ...current, [row.id]: !current[row.id] }))}
                  style={{ width: '100%', display: 'grid', gridTemplateColumns: summaryCols, gap: 10, padding: '12px 16px', minWidth: 980, alignItems: 'center', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
                >
                  <Copyable value={row.barcode} style={{ font: "800 12.5px 'JetBrains Mono'", color: ACCENT }} />
                  <div style={{ font: "600 11.5px 'Inter'", color: t.textMuted }}>
                    {row.cert_no ? <Copyable value={row.cert_no} /> : '—'}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: "700 11.5px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.rep_name}</div>
                    <div style={{ font: "500 10px 'Inter'", color: t.textFaint }}>Request #{row.request_id}</div>
                  </div>
                  <div style={{ font: "700 11px 'Inter'", color: t.textMuted }}>{row.fulfillment_branch || row.branch}</div>
                  <div style={{ font: "700 11px 'Inter'", color: t.textMuted }}>{row.current_branch}</div>
                  <div>
                    <div style={{ font: "700 10.5px 'Inter'", color: row.request_status === 'cancelled' ? RED : STATUS_COLOR[row.trackingStatus] || t.textMuted }}>
                      {row.request_status === 'cancelled' ? 'Request cancelled' : TRACKING_LABELS[row.trackingStatus]}
                    </div>
                    <div style={{ font: "600 9.5px 'Inter'", color: t.textFaint, marginTop: 3 }}>{row.currentStockStatusLabel}</div>
                  </div>
                  <div style={{ font: "600 10px 'Inter'", color: latest ? t.textMuted : t.textFaint }}>{latest?.movementLabel || 'Requested'}</div>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
                </button>

                {open && (
                  <div style={{ padding: '0 16px 16px', background: t.bgSide, overflowX: 'auto' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))', gap: 9, padding: '12px 0 4px', minWidth: 760 }}>
                      <div style={{ padding: 10, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8 }}>
                        <div style={{ font: "800 9.5px 'Inter'", color: t.textFaint }}>DAILY EXCEL SNAPSHOT</div>
                        <div style={{ marginTop: 5, font: "700 11px 'Inter'", color: row.snapshot.active ? t.text : AMBER }}>
                          {row.snapshot.active ? `${row.snapshot.branch || 'Unknown branch'} · ${row.currentStockStatusLabel}` : 'Not in latest ERP snapshot'}
                        </div>
                        <div style={{ marginTop: 4, font: "500 9.5px 'Inter'", color: t.textFaint }}>
                          {row.snapshot.lastSeenAt ? `Last seen ${formatDate(row.snapshot.lastSeenAt)}` : row.snapshot.missingSince ? `Missing since ${formatDate(row.snapshot.missingSince)}` : 'No snapshot timestamp'}
                        </div>
                      </div>
                      <div style={{ padding: 10, background: t.bgCard, border: `1px solid ${row.snapshotReconciliation.state === 'mismatch' ? RED : t.border}`, borderRadius: 8 }}>
                        <div style={{ font: "800 9.5px 'Inter'", color: t.textFaint }}>SNAPSHOT RECONCILIATION</div>
                        <div style={{ marginTop: 5, font: "700 11px 'Inter'", color: row.snapshotReconciliation.state === 'mismatch' ? RED : row.snapshotReconciliation.state === 'reconciled' ? GREEN : t.text }}>
                          {row.snapshotReconciliation.label}
                        </div>
                      </div>
                      <div style={{ padding: 10, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8 }}>
                        <div style={{ font: "800 9.5px 'Inter'", color: t.textFaint }}>LIVE / CONFIRMED ERP</div>
                        <div style={{ marginTop: 5, font: "700 10.5px 'Inter'", color: row.erp_transfer_confirmed ? GREEN : t.textFaint }}>BT issued: {row.erp_transfer_confirmed ? 'yes' : 'no'}</div>
                        <div style={{ marginTop: 3, font: "700 10.5px 'Inter'", color: row.erp_transfer_received ? GREEN : t.textFaint }}>BT received: {row.erp_transfer_received ? 'yes' : 'no'}</div>
                        {row.liveErpVerification && <div style={{ marginTop: 3, font: "700 10px 'Inter'", color: GREEN }}>Availability rechecked live at {formatDate(row.liveErpVerification.verifiedAt)}</div>}
                        {row.request_status === 'cancelled' && <div style={{ marginTop: 3, font: "700 10px 'Inter'", color: RED }}>Rejected: {row.cancellation_status?.replaceAll('_', ' ') || 'unavailable'}{row.cancellation_reason ? ` · ${row.cancellation_reason}` : ''}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 0' }}>
                      {[row.shape || row.item || row.category, row.carat ? `${row.carat} cts` : row.diamond_cts ? `${row.diamond_cts} d.cts` : null, row.color, row.clarity, row.lab].filter(Boolean).map((value) => (
                        <span key={String(value)} style={{ padding: '4px 7px', borderRadius: 5, background: 'oklch(78% 0.13 240 / 0.13)', color: ACCENT, font: "700 10px 'Inter'" }}>{value}</span>
                      ))}
                    </div>

                    <div style={{ font: "800 12px 'Inter'", color: t.text, marginBottom: 9 }}>Stone movement history</div>
                    <div style={{ minWidth: 1100, border: `1px solid ${t.border}`, borderRadius: 9, overflow: 'hidden', background: t.bgCard }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '145px 80px 155px 95px minmax(160px,1fr) 90px 90px 115px minmax(120px,1fr)', gap: 10, padding: '10px 12px', font: "800 9.5px 'Inter'", color: t.textFainter }}>
                        <div>DATE</div><div>DOC NO</div><div>BARCODE</div><div>BRANCH</div><div>MOVEMENT</div><div>FROM</div><div>TO</div><div>CERTIFICATE</div><div>ACTOR</div>
                      </div>
                      {row.movements.map((event) => (
                        <div key={event.id} style={{ display: 'grid', gridTemplateColumns: '145px 80px 155px 95px minmax(160px,1fr) 90px 90px 115px minmax(120px,1fr)', gap: 10, padding: '11px 12px', alignItems: 'center', borderTop: `1px solid ${t.rowBorder}` }}>
                          <div style={{ font: "500 10.5px 'Inter'", color: t.textFaint }}>{formatDate(event.createdAt)}</div>
                          <div style={{ font: "700 10.5px 'Inter'", color: t.textMuted }}>#{row.request_id}</div>
                          <Copyable value={row.barcode} style={{ font: "700 11px 'JetBrains Mono'", color: ACCENT }} />
                          <div style={{ font: "700 10.5px 'Inter'", color: t.textMuted }}>{event.fromBranch || row.current_branch}</div>
                          <div style={{ font: "700 10.5px 'Inter'", color: event.movementType.includes('transfer') ? ACCENT : t.text }}>{event.movementLabel}</div>
                          <div style={{ font: "600 10.5px 'Inter'", color: t.textMuted }}>{event.fromBranch || '—'}</div>
                          <div style={{ font: "600 10.5px 'Inter'", color: t.textMuted }}>{event.toBranch || 'Customer'}</div>
                          <div style={{ font: "600 10.5px 'Inter'", color: row.cert_found ? ACCENT : t.textFaint }}>
                            {row.cert_found ? 'Confirmed' : row.cert_no ? <Copyable value={row.cert_no} /> : 'Pending'}
                          </div>
                          <div style={{ font: "600 10.5px 'Inter'", color: t.textMuted }}>{event.actorName}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!loading && total > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, color: t.textMuted, font: "500 12px 'Inter'" }}>
            <span>{total.toLocaleString()} tracked stone{total === 1 ? '' : 's'}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} style={{ padding: '7px 11px', border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, borderRadius: 5, cursor: page === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
              <button onClick={() => setPage((value) => value + 1)} disabled={page * 100 >= total} style={{ padding: '7px 11px', border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, borderRadius: 5, cursor: page * 100 >= total ? 'not-allowed' : 'pointer' }}>Next</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
