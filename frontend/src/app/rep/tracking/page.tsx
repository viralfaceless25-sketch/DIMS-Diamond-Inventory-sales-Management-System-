'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, TrackingRow } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranchSocket } from '@/lib/socket';
import { useTheme } from '../repContext';
import { ACCENT, AMBER, BLUE, GREEN, RED } from '@/lib/theme';
import { TRACKING_LABELS } from '@/lib/utils';
import { Copyable, LoadError, NonCertBadge } from '@/components/ui';
import { useAsyncLoad } from '@/lib/useAsyncLoad';

const EMPTY_TRACKING: { rows: TrackingRow[]; total: number } = { rows: [], total: 0 };

const STATUS_COLOR: Record<string, string> = {
  requested: AMBER,
  partially_given: AMBER,
  with_rep: ACCENT,
  returned: BLUE,
};

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function RepTrackingPage() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const loader = useCallback(() => api.tracking('ALL', search, 1), [search]);
  const { data, loading, error, reload } = useAsyncLoad(loader, EMPTY_TRACKING);
  const rows = data.rows;

  useBranchSocket(user?.branch || 'NY', () => reload());

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '22px 26px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 18, marginBottom: 18 }}>
        <div>
          <div style={{ font: "800 21px 'Inter'", color: t.text }}>My stone tracking</div>
          <div style={{ font: "500 13.5px 'Inter'", color: t.textFaint, marginTop: 4 }}>Movement history is restricted to stones on your own requests.</div>
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search barcode or certificate"
          style={{ width: 310, maxWidth: '45%', background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: '9px 11px', color: t.text, font: "500 13.5px 'Inter'", outline: 'none' }}
        />
      </div>

      {loading ? (
        <div style={{ padding: 44, textAlign: 'center', color: t.textFaint, font: "500 14px 'Inter'" }}>Loading…</div>
      ) : error ? (
        <LoadError message={error} onRetry={reload} t={t} />
      ) : rows.length === 0 ? (
        <div style={{ padding: 44, textAlign: 'center', background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, color: t.textFaint, font: "500 14px 'Inter'" }}>No tracked stones match your search.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {rows.map((row) => {
            const expanded = open[row.id];
            const latest = row.movements[0];
            return (
              <div key={row.id} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 11, overflow: 'hidden' }}>
                <button
                  onClick={() => setOpen((current) => ({ ...current, [row.id]: !current[row.id] }))}
                  style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(150px,1fr) 110px 90px minmax(150px,1fr) 120px 28px', gap: 10, padding: '13px 15px', alignItems: 'center', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
                >
                  <div>
                    <Copyable value={row.barcode} style={{ font: "800 14px 'JetBrains Mono'", color: ACCENT }} />
                    <div style={{ font: "500 11.5px 'Inter'", color: t.textFaint, marginTop: 3 }}>
                      {row.cert_no ? <Copyable value={row.cert_no} /> : <NonCertBadge />}
                    </div>
                  </div>
                  <div style={{ font: "700 12.5px 'Inter'", color: t.textMuted }}>{row.fulfillment_branch || row.branch} → {row.delivery_branch || row.branch}</div>
                  <div>
                    <div style={{ font: "700 12.5px 'Inter'", color: row.request_status === 'cancelled' ? RED : STATUS_COLOR[row.trackingStatus] }}>
                      {row.request_status === 'cancelled' ? 'Request cancelled' : TRACKING_LABELS[row.trackingStatus]}
                    </div>
                    <div style={{ marginTop: 3, font: "600 11px 'Inter'", color: t.textFaint }}>{row.currentStockStatusLabel}</div>
                  </div>
                  <div style={{ font: "600 12.5px 'Inter'", color: t.textMuted }}>{latest?.movementLabel || 'Requested'}</div>
                  <Link href={`/rep/my-requests?requestId=${row.request_id}`} onClick={(event) => event.stopPropagation()} style={{ color: ACCENT, font: "700 12.5px 'Inter'", textDecoration: 'none' }}>Request #{row.request_id}</Link>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
                </button>

                {expanded && (
                  <div style={{ borderTop: `1px solid ${t.border}`, background: t.bgSide, padding: '12px 15px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px,1fr))', gap: 8, marginBottom: 12 }}>
                      <div style={{ padding: 9, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 7 }}>
                        <div style={{ font: "800 11px 'Inter'", color: t.textFaint }}>MORNING EXCEL SNAPSHOT</div>
                        <div style={{ marginTop: 4, font: "700 12.5px 'Inter'", color: row.snapshot.active ? t.text : AMBER }}>
                          {row.snapshot.active ? `${row.snapshot.branch || 'Unknown'} · ${row.currentStockStatusLabel}` : 'Not in latest snapshot'}
                        </div>
                      </div>
                      <div style={{ padding: 9, background: t.bgCard, border: `1px solid ${row.snapshotReconciliation.state === 'mismatch' ? RED : t.border}`, borderRadius: 7 }}>
                        <div style={{ font: "800 11px 'Inter'", color: t.textFaint }}>RECONCILIATION</div>
                        <div style={{ marginTop: 4, font: "700 12.5px 'Inter'", color: row.snapshotReconciliation.state === 'mismatch' ? RED : row.snapshotReconciliation.state === 'reconciled' ? GREEN : t.text }}>
                          {row.snapshotReconciliation.label}
                        </div>
                      </div>
                      <div style={{ padding: 9, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 7 }}>
                        <div style={{ font: "800 11px 'Inter'", color: t.textFaint }}>CONFIRMED LIVE ERP</div>
                        <div style={{ marginTop: 4, font: "700 12px 'Inter'", color: row.erp_transfer_confirmed ? GREEN : t.textFaint }}>BT issued: {row.erp_transfer_confirmed ? 'yes' : 'no'}</div>
                        <div style={{ marginTop: 3, font: "700 12px 'Inter'", color: row.erp_transfer_received ? GREEN : t.textFaint }}>BT received: {row.erp_transfer_received ? 'yes' : 'no'}</div>
                        {row.liveErpVerification && <div style={{ marginTop: 3, font: "700 11.5px 'Inter'", color: GREEN }}>Availability verified live</div>}
                        {row.request_status === 'cancelled' && <div style={{ marginTop: 3, font: "700 11.5px 'Inter'", color: RED }}>{row.cancellation_status?.replaceAll('_', ' ') || 'Unavailable'}{row.cancellation_reason ? ` · ${row.cancellation_reason}` : ''}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(150px,1fr) 85px 85px 130px', gap: 10, padding: '0 8px 8px', color: t.textFaint, font: "800 11px 'Inter'" }}>
                      <div>DATE</div><div>MOVEMENT</div><div>FROM</div><div>TO</div><div>UPDATED BY</div>
                    </div>
                    {row.movements.map((event) => (
                      <div key={event.id} style={{ display: 'grid', gridTemplateColumns: '150px minmax(150px,1fr) 85px 85px 130px', gap: 10, padding: '9px 8px', borderTop: `1px solid ${t.rowBorder}`, alignItems: 'center' }}>
                        <div style={{ font: "500 12px 'Inter'", color: t.textFaint }}>{formatDate(event.createdAt)}</div>
                        <div style={{ font: "700 12.5px 'Inter'", color: event.movementType.includes('transfer') ? ACCENT : t.text }}>{event.movementLabel}</div>
                        <div style={{ font: "600 12px 'Inter'", color: t.textMuted }}>{event.fromBranch || '—'}</div>
                        <div style={{ font: "600 12px 'Inter'", color: t.textMuted }}>{event.toBranch || 'Customer'}</div>
                        <div style={{ font: "600 12px 'Inter'", color: t.textMuted }}>{event.actorName}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
