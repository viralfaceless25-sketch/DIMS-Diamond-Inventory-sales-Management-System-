'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, MyRequest, RequestStone } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { TopBar } from '@/components/TopBar';
import { Avatar, StatusBadge } from '@/components/ui';
import { ACCENT, repColor } from '@/lib/theme';
import { fmtCarat, timeAgo } from '@/lib/utils';

export default function RepHistoryPage() {
  const { theme: t } = useTheme();
  const params = useParams<{ id: string }>();
  const repId = Number(params.id);
  const [reps, setReps] = useState<{ id: number; name: string; branch: string }[]>([]);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const rep = useMemo(() => reps.find((r) => r.id === repId), [reps, repId]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      const [repRows, requestRows] = await Promise.all([
        api.reps(),
        Number.isFinite(repId) ? api.myRequests(repId) : Promise.resolve([]),
      ]);
      if (!alive) return;
      setReps(repRows);
      setRequests(requestRows);
      setLoading(false);
    }
    load().catch(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [repId]);

  return (
    <>
      <TopBar title={rep ? `${rep.name} Requests` : 'Sales Rep Requests'} branch={rep?.branch || 'ALL'} onBranch={() => {}} t={t} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <Avatar name={rep?.name || 'Sales Rep'} color={repColor(rep?.name || 'Sales Rep')} size={42} />
          <div>
            <div style={{ font: "800 16px 'Inter'", color: t.text }}>{rep?.name || 'Sales Rep'}</div>
            <div style={{ font: "500 11.5px 'Inter'", color: t.textFaint }}>{rep?.branch || '-'} branch - {requests.length} request{requests.length === 1 ? '' : 's'}</div>
          </div>
        </div>

        {loading ? (
          <Empty t={t}>Loading...</Empty>
        ) : requests.length === 0 ? (
          <Empty t={t}>No requests for this sales rep yet.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
            {requests.map((request) => (
              <div key={request.id} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)', gap: 10 }}>
                <Avatar name={rep?.name || 'Rep'} color={repColor(rep?.name || 'Rep')} size={28} />
                <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ font: "700 12px 'Inter'", color: ACCENT }}>{rep?.name || 'Sales Rep'}</div>
                    <StatusBadge status={request.status} />
                    <div style={{ marginLeft: 'auto', font: "500 11px 'Inter'", color: t.textFaint }}>{timeAgo(request.requestedAt)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {request.stones.map((stone) => <StoneLine key={stone.id} stone={stone} t={t} />)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <div style={{ font: "700 11px 'Inter'", color: t.text }}>t/s</div>
                    <div style={{ font: "500 11px 'Inter'", color: t.textFaint }}>{new Date(request.requestedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function StoneLine({ stone, t }: { stone: RequestStone; t: import('@/lib/theme').Theme }) {
  const isJewelry = stone.item_type === 'jewelry';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr) 70px 48px 64px', gap: 10, alignItems: 'center' }}>
      <div style={{ font: "800 12.5px 'JetBrains Mono'", color: ACCENT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stone.barcode}</div>
      <div style={{ font: "700 12px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isJewelry ? (stone.item || stone.category || 'Jewelry') : (stone.shape || '-')}</div>
      <div style={{ font: "700 12px 'JetBrains Mono'", color: t.text }}>{isJewelry ? (stone.category || '-') : fmtCarat(stone.carat)}</div>
      <div style={{ font: "700 12px 'JetBrains Mono'", color: t.text }}>{stone.color || '-'}</div>
      <div style={{ font: "700 12px 'JetBrains Mono'", color: t.text }}>{stone.clarity || '-'}</div>
    </div>
  );
}

function Empty({ children, t }: { children: React.ReactNode; t: import('@/lib/theme').Theme }) {
  return <div style={{ padding: 50, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFaint, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12 }}>{children}</div>;
}
