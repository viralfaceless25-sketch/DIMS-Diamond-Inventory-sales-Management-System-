'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, MyRequest, RequestStone } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { TopBar } from '@/components/TopBar';
import { Avatar, LoadError, StatusBadge } from '@/components/ui';
import { useAsyncLoad } from '@/lib/useAsyncLoad';
import { ACCENT, repColor } from '@/lib/theme';
import { fmtCarat, timeAgo } from '@/lib/utils';

const EMPTY_REPS: { reps: { id: number; name: string; branch: string }[]; requests: MyRequest[] } = { reps: [], requests: [] };

export default function RepHistoryPage() {
  return (
    <Suspense fallback={<div style={{ padding: 50, textAlign: 'center' }}>Loading...</div>}>
      <RepHistoryContent />
    </Suspense>
  );
}

function RepHistoryContent() {
  const { theme: t } = useTheme();
  const searchParams = useSearchParams();
  const repId = Number(searchParams.get('id'));

  // Previously the failure was swallowed and the page rendered "No requests
  // for this sales rep yet", which reads as a real answer.
  const loader = useCallback(async () => {
    const [repRows, requestRows] = await Promise.all([
      api.reps(),
      Number.isFinite(repId) ? api.myRequests(repId) : Promise.resolve([]),
    ]);
    return { reps: repRows, requests: requestRows };
  }, [repId]);
  const { data, loading, error, reload } = useAsyncLoad(loader, EMPTY_REPS);
  const reps = data.reps;
  const requests = data.requests;

  const rep = useMemo(() => reps.find((r) => r.id === repId), [reps, repId]);

  return (
    <>
      <TopBar title={rep ? `${rep.name} Requests` : 'Sales Rep Requests'} branch={rep?.branch || 'ALL'} onBranch={() => {}} t={t} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <Avatar name={rep?.name || 'Sales Rep'} color={repColor(rep?.name || 'Sales Rep')} size={42} />
          <div>
            <div style={{ font: "800 18px 'Inter'", color: t.text }}>{rep?.name || 'Sales Rep'}</div>
            <div style={{ font: "500 13.5px 'Inter'", color: t.textFaint }}>{rep?.branch || '-'} branch - {requests.length} request{requests.length === 1 ? '' : 's'}</div>
          </div>
        </div>

        {loading ? (
          <Empty t={t}>Loading...</Empty>
        ) : error ? (
          <LoadError message={error} onRetry={reload} t={t} />
        ) : requests.length === 0 ? (
          <Empty t={t}>No requests for this sales rep yet.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
            {requests.map((request) => (
              <div key={request.id} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)', gap: 10 }}>
                <Avatar name={rep?.name || 'Rep'} color={repColor(rep?.name || 'Rep')} size={28} />
                <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ font: "700 14px 'Inter'", color: ACCENT }}>{rep?.name || 'Sales Rep'}</div>
                    <StatusBadge status={request.status} />
                    <div style={{ marginLeft: 'auto', font: "500 13px 'Inter'", color: t.textFaint }}>{timeAgo(request.requestedAt)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {request.stones.map((stone) => <StoneLine key={stone.id} stone={stone} t={t} />)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <div style={{ font: "700 13px 'Inter'", color: t.text }}>t/s</div>
                    <div style={{ font: "500 13px 'Inter'", color: t.textFaint }}>{new Date(request.requestedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
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
      <div style={{ font: "800 14.5px 'JetBrains Mono'", color: ACCENT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stone.barcode}</div>
      <div style={{ font: "700 14px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isJewelry ? (stone.item || stone.category || 'Jewelry') : (stone.shape || '-')}</div>
      <div style={{ font: "700 14px 'JetBrains Mono'", color: t.text }}>{isJewelry ? (stone.category || '-') : fmtCarat(stone.carat)}</div>
      <div style={{ font: "700 14px 'JetBrains Mono'", color: t.text }}>{stone.color || '-'}</div>
      <div style={{ font: "700 14px 'JetBrains Mono'", color: t.text }}>{stone.clarity || '-'}</div>
    </div>
  );
}

function Empty({ children, t }: { children: React.ReactNode; t: import('@/lib/theme').Theme }) {
  return <div style={{ padding: 50, textAlign: 'center', font: "400 15px 'Inter'", color: t.textFaint, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12 }}>{children}</div>;
}
