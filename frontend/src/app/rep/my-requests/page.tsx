'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, MyRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranchSocket } from '@/lib/socket';
import { useTheme } from '../repContext';
import { AMBER, GREEN } from '@/lib/theme';
import { timeAgo, fmtCarat, sortStonesClient, STATUS_LABELS } from '@/lib/utils';
import { Check } from '@/components/ui';

export default function MyRequestsPage() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [labelFor, setLabelFor] = useState<number | null>(null);
  const [labelMessage, setLabelMessage] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!user?.salesRepId) return;
    setLoading(true);
    setRequests(await api.myRequests(user.salesRepId));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadLabel(file: File) {
    if (!labelFor) return;
    try {
      await api.uploadShippingLabel(labelFor, file);
      setLabelMessage(`Shipping label saved for request #${labelFor}.`);
      await load();
    } catch (err) { setLabelMessage(err instanceof Error ? err.message : 'Could not upload the shipping label.'); }
    finally { setLabelFor(null); if (labelInputRef.current) labelInputRef.current.value = ''; }
  }

  async function setPaperwork(requestId: number, paperworkType: 'none' | 'invoice' | 'memo') {
    try {
      await api.setPaperworkType(requestId, paperworkType);
      setLabelMessage(`${paperworkType === 'none' ? 'No paperwork' : paperworkType === 'invoice' ? 'Invoice' : 'Memo'} saved for request #${requestId}.`);
      await load();
    } catch (err) { setLabelMessage(err instanceof Error ? err.message : 'Could not update paperwork.'); }
  }

  useBranchSocket(user?.branch || 'NY', () => load());

  const statusColor = (s: string) => (s === 'fulfilled' ? GREEN : AMBER);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '20px 26px 14px' }}>
        <div style={{ font: "700 18px 'Inter'", color: t.text }}>My requests</div>
        <div style={{ font: "400 12px 'Inter'", color: t.textFaint, marginTop: 3 }}>Live status of everything you&apos;ve submitted to inventory.</div>
      </div>
      <input ref={labelInputRef} type="file" accept="application/pdf,image/png,image/jpeg" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadLabel(file); }} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 26px 26px' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFaint }}>Loading…</div>
        ) : requests.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFaint }}>You haven&apos;t submitted any requests yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.map((r) => {
              const isOpen = open[r.id];
              const pendingPaperwork = r.crossBranch && r.deliveryRoute === 'customer_ship' && r.paperworkType === 'pending';
              const pendingLabel = r.crossBranch && r.deliveryRoute === 'customer_ship' && !r.hasLabel;
              return (
                <div key={r.id} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div onClick={() => setOpen((p) => ({ ...p, [r.id]: !p[r.id] }))} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 110px 34px', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}>
                    <div style={{ minWidth: 0 }}><div style={{ font: "600 13px 'Inter'", color: t.text }}>Request #{r.id}</div>{(pendingPaperwork || pendingLabel) && <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>{pendingPaperwork && <span style={{ font: "800 9.5px 'Inter'", color: AMBER }}>PENDING PAPERWORK</span>}{pendingLabel && <span style={{ font: "800 9.5px 'Inter'", color: AMBER }}>PENDING LABEL</span>}</div>}</div>
                    <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>{r.branch}</div>
                    <div style={{ font: "400 11.5px 'Inter'", color: t.textFaint }}>{timeAgo(r.requestedAt)}</div>
                    <div style={{ font: "600 10.5px 'Inter'", color: statusColor(r.status) }}>{STATUS_LABELS[r.status]}</div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="M6 9l6 6 6-6" /></svg>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${t.border}` }}>
                      {r.crossBranch && <div style={{ padding: '10px 16px', borderBottom: `1px solid ${t.border}`, font: "600 11px 'Inter'", color: t.textMuted, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span>From {r.fulfillmentBranch || r.branch} to {r.deliveryBranch || r.branch}</span>
                        <span>{r.deliveryRoute === 'internal_transfer' ? 'Internal transfer' : r.deliveryRoute === 'customer_ship' ? 'Ship to customer' : 'Drop off to customer'}</span>
                        <span>Paperwork: {r.paperworkType === 'pending' ? 'pending decision' : r.paperworkType === 'none' ? 'no paperwork' : r.paperworkType}</span>
                        <span>Status: {r.transferStatus?.replaceAll('_', ' ') || 'awaiting source'}</span>
                        {pendingPaperwork && <><span style={{ font: "800 10px 'Inter'", color: AMBER }}>PENDING PAPERWORK</span><button onClick={(event) => { event.stopPropagation(); setPaperwork(r.id, 'none'); }} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, cursor: 'pointer', font: "700 10.5px 'Inter'" }}>No paperwork</button><button onClick={(event) => { event.stopPropagation(); setPaperwork(r.id, 'invoice'); }} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, cursor: 'pointer', font: "700 10.5px 'Inter'" }}>Invoice</button><button onClick={(event) => { event.stopPropagation(); setPaperwork(r.id, 'memo'); }} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, cursor: 'pointer', font: "700 10.5px 'Inter'" }}>Memo</button></>}
                        {pendingLabel && <span style={{ font: "800 10px 'Inter'", color: AMBER }}>PENDING LABEL</span>}
                        {r.deliveryRoute === 'customer_ship' && ['awaiting_source', 'packed'].includes(r.transferStatus || 'awaiting_source') && <button onClick={(event) => { event.stopPropagation(); setLabelFor(r.id); labelInputRef.current?.click(); }} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, cursor: 'pointer', font: "700 10.5px 'Inter'" }}>Upload shipping label</button>}
                      </div>}
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 90px 70px 50px 60px 44px 44px', gap: 8, padding: '9px 16px', font: "600 9.5px 'Inter'", color: t.textFaint }}>
                        <div>STOCK #</div><div>SHAPE</div><div>CARAT</div><div>COL</div><div>CLTY</div><div title="Stone found">STN</div><div title="Cert found">CRT</div>
                      </div>
                      {sortStonesClient(r.stones).map((s) => (
                        <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 90px 70px 50px 60px 44px 44px', gap: 8, padding: '9px 16px', alignItems: 'center', borderTop: `1px solid ${t.rowBorder}` }}>
                          <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.barcode}</div>
                          <div style={{ font: "400 11.5px 'Inter'", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.item_type === 'jewelry' ? (s.item || s.category || 'Jewelry') : (s.shape || '—')}</div>
                          <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>{s.item_type === 'jewelry' ? `${fmtCarat(s.carat)} d.cts` : fmtCarat(s.carat)}</div>
                          <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text }}>{s.color || '—'}</div>
                          <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text }}>{s.clarity || '—'}</div>
                          <Check checked={s.stone_found} disabled size={16} />
                          <Check checked={s.cert_found} disabled size={16} />
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
      {labelMessage && <div style={{ position: 'fixed', right: 22, bottom: 22, padding: '10px 13px', background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, font: "600 12px 'Inter'" }}>{labelMessage}</div>}
    </div>
  );
}
