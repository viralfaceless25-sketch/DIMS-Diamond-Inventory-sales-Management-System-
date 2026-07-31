'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, RequestSummary, RequestDetail, RequestStats, RequestStone, StockRecheck } from '@/lib/api';
import { useBranchSocket } from '@/lib/socket';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/auth';
import { TopBar } from '@/components/TopBar';
import { Check, StatusBadge, DuplicateBadge, Avatar } from '@/components/ui';
import { ACCENT, AMBER, avatarColor, RED } from '@/lib/theme';
import { timeAgo, fmtCarat } from '@/lib/utils';
import {
  canResolveSourceItems,
  documentStepState,
  hasDeliveryWorkflow,
} from '@/lib/requestWorkflow';

const STONE_TABLE_COLS = '58px 58px 58px minmax(170px,1.35fr) minmax(150px,1fr) 96px 72px 88px minmax(170px,1fr)';

export default function RequestsPage() {
  const { theme: t } = useTheme();
  const { user } = useAuth();
  // Inventory staff are pinned to their own branch. The server enforces this too;
  // this keeps the visible queue and socket subscription on the room's branch.
  const [branch, setBranch] = useState(user?.branch || 'ALL');
  const [view, setView] = useState<'active' | 'completed'>('active');
  const [sort, setSort] = useState<'recent' | 'most_stones'>('recent');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<RequestStats | null>(null);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [expanded, setExpanded] = useState<Record<number, RequestDetail>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [scanMessage, setScanMessage] = useState('');
  const [copiedBarcode, setCopiedBarcode] = useState('');
  const [rechecks, setRechecks] = useState<StockRecheck[]>([]);
  const [loading, setLoading] = useState(true);
  const scannerBufferRef = useRef({ value: '', lastKeyAt: 0 });
  const scannerTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, recheckQueue] = await Promise.all([
        api.stats(branch),
        api.requests({ branch, view, sort, search }),
        api.stockRecheckQueue(),
      ]);
      setStats(s);
      setRequests(r);
      setRechecks(recheckQueue.rows);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not load the inventory request queue.');
    } finally {
      setLoading(false);
    }
  }, [branch, view, sort, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (user?.branch && user.branch !== branch) setBranch(user.branch);
  }, [user?.branch, branch]);
  useBranchSocket(branch, () => load());

  async function toggleExpand(id: number) {
    if (expanded[id]) {
      setExpanded((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      return;
    }
    const detail = await api.requestDetail(id);
    setExpanded((p) => ({ ...p, [id]: detail }));
  }

  async function toggleStone(reqId: number, stone: RequestStone, field: 'stone_found' | 'cert_found' | 'returned') {
    const res = await api.toggleStone(reqId, stone.id, field, !stone[field]);
    setExpanded((p) => {
      if (!p[reqId]) return p;
      return { ...p, [reqId]: { ...p[reqId], status: res.status, stones: res.stones } };
    });
    load();
  }

  async function checkAll(reqId: number, value: boolean, field?: 'stone_found' | 'cert_found' | 'returned') {
    const res = await api.checkAll(reqId, value, field);
    setExpanded((p) => {
      if (!p[reqId]) return p;
      return { ...p, [reqId]: { ...p[reqId], status: res.status, stones: res.stones } };
    });
    load();
  }

  async function confirmResolution(requestId: number) {
    if (!window.confirm('Confirm this request with the currently checked items. Unchecked items will be recorded as not found.')) return;
    try {
      const res = await api.confirmResolution(requestId);
      setExpanded((current) => current[requestId]
        ? { ...current, [requestId]: { ...current[requestId], status: res.status, stones: res.stones, resolutionConfirmed: true } }
        : current);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not resolve this request.');
    }
  }

  async function scanRequestedStone(requestId: number, detail: RequestDetail, scope: RequestSummary['requestScope'], rawBarcode: string) {
    const barcode = rawBarcode.trim().toUpperCase();
    if (!barcode) return;
    const stone = detail.stones.find((item) => item.barcode.toUpperCase() === barcode);
    if (!stone) { setScanMessage(`Barcode ${barcode} is not in this request.`); return; }
    const field = scope === 'cert_only' ? 'cert_found' : 'stone_found';
    if (stone[field]) { setScanMessage(`${barcode} is already marked found.`); return; }
    try {
      const res = await api.toggleStone(requestId, stone.id, field, true);
      setExpanded((current) => current[requestId] ? { ...current, [requestId]: { ...current[requestId], status: res.status, stones: res.stones } } : current);
      setScanMessage(`${barcode} matched and marked found.`);
      await load();
    } catch (err) {
      setScanMessage(err instanceof Error ? err.message : 'Could not mark the scanned barcode.');
    }
  }

  useEffect(() => {
    const openRequests = Object.entries(expanded).map(([id, detail]) => ({
      id: Number(id),
      detail,
      summary: requests.find((request) => request.id === Number(id)),
    })).filter((request): request is { id: number; detail: RequestDetail; summary: RequestSummary } => Boolean(request.summary));

    if (!openRequests.length) return;

    function submitBufferedBarcode() {
      const barcode = scannerBufferRef.current.value;
      scannerBufferRef.current = { value: '', lastKeyAt: 0 };
      if (barcode.length < 5) return;
      const matched = openRequests.find((request) => request.detail.stones.some((stone) => stone.barcode.toUpperCase() === barcode.toUpperCase()));
      if (!matched) {
        setScanMessage(`Barcode ${barcode.toUpperCase()} is not in an open request.`);
        return;
      }
      scanRequestedStone(matched.id, matched.detail, matched.summary.requestScope, barcode);
    }

    function handleScannerKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const now = Date.now();

      if (event.key === 'Enter') {
        if (scannerTimerRef.current) window.clearTimeout(scannerTimerRef.current);
        event.preventDefault();
        event.stopPropagation();
        submitBufferedBarcode();
        return;
      }

      if (event.key.length !== 1) return;
      if (now - scannerBufferRef.current.lastKeyAt > 120) scannerBufferRef.current.value = '';
      scannerBufferRef.current.value += event.key;
      scannerBufferRef.current.lastKeyAt = now;
      if (scannerTimerRef.current) window.clearTimeout(scannerTimerRef.current);
      scannerTimerRef.current = window.setTimeout(submitBufferedBarcode, 180);
    }

    window.addEventListener('keydown', handleScannerKey, true);
    return () => {
      window.removeEventListener('keydown', handleScannerKey, true);
      if (scannerTimerRef.current) window.clearTimeout(scannerTimerRef.current);
    };
  }, [expanded, requests]);

  function groupAccent(label: string) {
    if (label.includes('NY')) return ACCENT;
    if (label.includes('LA')) return 'oklch(70% 0.14 305)';
    return 'oklch(74% 0.13 205)';
  }

  async function updateTransfer(requestId: number, action: 'pack' | 'ship' | 'ship_customer' | 'dropoff_customer') {
    try { await api.setTransferStatus(requestId, action); await load(); }
    catch (err) { window.alert(err instanceof Error ? err.message : 'Could not update this transfer.'); }
  }

  async function confirmErpTransfer(requestId: number) {
    if (!window.confirm('Confirm that the supplying branch issued this branch transfer in Maitri ERP.')) return;
    try {
      await api.confirmErpTransfer(requestId);
      setExpanded((current) => current[requestId]
        ? { ...current, [requestId]: { ...current[requestId], erpTransferConfirmed: true } }
        : current);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not confirm the ERP branch transfer.');
    }
  }

  async function confirmErpReceived(requestId: number) {
    if (!window.confirm('Confirm that this branch received the BT digitally in Maitri ERP. Physical arrival is tracked separately.')) return;
    try {
      await api.confirmErpReceived(requestId);
      setExpanded((current) => current[requestId]
        ? { ...current, [requestId]: { ...current[requestId], erpTransferReceived: true } }
        : current);
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not confirm ERP BT receipt.');
    }
  }

  async function rejectErpTransfer(request: RequestSummary) {
    const liveStatus = window.prompt(
      'Current Maitri ERP status (On Hold, On Memo, In Transit, Sold, or another unavailable status):',
      'On Hold'
    );
    if (!liveStatus) return;
    const reason = window.prompt(
      'Optional note for the sales rep:',
      `Cannot issue BT from ${request.fulfillmentBranch}`
    ) || undefined;
    if (!window.confirm(`Cancel request #${request.id} because ERP now shows "${liveStatus}"?`)) return;
    try {
      await api.rejectErpUnavailable(request.id, liveStatus, reason);
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not reject this ERP BT.');
    }
  }

  async function resolveRecheck(
    recheck: StockRecheck,
    result:
      | { decision: 'available'; note?: string }
      | { decision: 'unavailable'; liveStatus: string; note?: string }
  ) {
    try {
      await api.resolveStockRecheck(recheck.id, result);
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not resolve the live ERP recheck.');
    }
  }

  async function copyBarcode(barcode: string) {
    try {
      await navigator.clipboard.writeText(barcode);
      setCopiedBarcode(barcode);
      window.setTimeout(() => setCopiedBarcode((current) => current === barcode ? '' : current), 1800);
    } catch {
      window.alert(`Could not copy ${barcode}. Select the barcode and copy it manually.`);
    }
  }

  async function openShippingLabel(requestId: number) {
    try {
      const url = await api.shippingLabelUrl(requestId);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not open the shipping label.');
    }
  }

  async function openPaperwork(requestId: number) {
    try {
      const url = await api.paperworkUrl(requestId);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not open the invoice or memo.');
    }
  }

  function requestDocumentState(r: RequestSummary) {
    return documentStepState({
      workflowVersion: r.workflowVersion,
      crossBranch: r.crossBranch,
      erpTransferReceived: r.erpTransferReceived,
      paperworkType: r.paperworkType,
      hasPaperwork: r.hasPaperwork,
      hasLabel: r.hasLabel,
    });
  }

  function transferNext(r: RequestSummary, itemsConfirmed = false): { action: 'pack' | 'ship' | 'ship_customer' | 'dropoff_customer'; label: string } | null {
    if (r.status === 'cancelled' || r.status === 'fulfilled') return null;
    if (!hasDeliveryWorkflow(r.crossBranch, r.deliveryRoute)) return null;
    const status = r.transferStatus || 'awaiting_source';
    const isSource = user?.branch === r.fulfillmentBranch;
    if (status === 'awaiting_source' && isSource && (!r.crossBranch || r.erpTransferConfirmed)) return { action: 'pack', label: 'Mark packed' };
    if (status === 'packed' && r.deliveryRoute === 'internal_transfer' && isSource) return { action: 'ship', label: `Ship to ${r.deliveryBranch}` };
    if (status === 'packed'
        && r.deliveryRoute === 'customer_ship'
        && itemsConfirmed
        && r.resolutionConfirmed
        && isSource
        && requestDocumentState(r).ready) {
      return { action: 'ship_customer', label: 'Ship to customer' };
    }
    if (status === 'packed' && r.deliveryRoute === 'customer_dropoff' && itemsConfirmed && r.resolutionConfirmed && isSource) return { action: 'dropoff_customer', label: 'Mark dropped off' };
    return null;
  }

  const requestGroups = requests.reduce<Array<{ key: string; label: string; requests: RequestSummary[] }>>((acc, req) => {
    const route = req.crossBranch ? `${req.fulfillmentBranch} to ${req.deliveryBranch}` : `${req.branch} local`;
    const key = `${route}-${req.requestType}`;
    const label = `${route} - ${requestTypeLabel(req.requestType)}`;
    let group = acc.find((g) => g.key === key);
    if (!group) {
      group = { key, label, requests: [] };
      acc.push(group);
    }
    group.requests.push(req);
    return acc;
  }, []).map((group) => ({ ...group, requests: [...group.requests].sort((a, b) => a.rep.name.localeCompare(b.rep.name) || new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()) }));

  function requestTypeLabel(type: RequestSummary['requestType']) {
    const labels = { urgent: 'Urgent', local: 'Local', ship: 'Ship', dropoff: 'Drop-off', pickup: 'Pickup' };
    return labels[type] || type;
  }

  function requestTypeStyle(type: RequestSummary['requestType']) {
    const styles = {
      urgent: { bg: 'oklch(68% 0.21 25 / 0.18)', border: 'oklch(68% 0.21 25 / 0.42)', text: 'oklch(68% 0.21 25)' },
      pickup: { bg: 'oklch(74% 0.13 205 / 0.18)', border: 'oklch(74% 0.13 205 / 0.42)', text: 'oklch(74% 0.13 205)' },
      ship: { bg: 'oklch(70% 0.13 250 / 0.18)', border: 'oklch(70% 0.13 250 / 0.42)', text: 'oklch(70% 0.13 250)' },
      dropoff: { bg: 'oklch(73% 0.14 305 / 0.18)', border: 'oklch(73% 0.14 305 / 0.42)', text: 'oklch(73% 0.14 305)' },
      local: { bg: 'oklch(78% 0.13 240 / 0.18)', border: 'oklch(78% 0.13 240 / 0.38)', text: ACCENT },
    };
    return styles[type] || styles.local;
  }

  function requestScopeLabel(scope: RequestSummary['requestScope']) {
    const labels = { stone_and_cert: 'Stone + cert', stone_only: 'Stone only', cert_only: 'Cert only' };
    return labels[scope] || scope;
  }

  function isRequestChecked(r: RequestSummary, detail: RequestDetail | undefined) {
    if (!detail) return false;
    return detail.stones.every((s) => {
      if (r.requestScope === 'stone_only') return s.stone_found;
      if (r.requestScope === 'cert_only') return s.cert_found;
      return s.stone_found && s.cert_found;
    });
  }

  function canResolveItems(r: RequestSummary) {
    return canResolveSourceItems({
      status: r.status,
      fulfillmentBranch: r.fulfillmentBranch,
      deliveryRoute: r.deliveryRoute,
      transferStatus: r.transferStatus,
    }, user?.branch);
  }

  function canMarkReturned(r: RequestSummary) {
    if (r.status !== 'fulfilled') return false;
    if (!r.crossBranch) return user?.branch === r.fulfillmentBranch;
    if (r.deliveryRoute === 'internal_transfer') {
      return user?.branch === r.deliveryBranch
        && r.transferStatus === 'handed_to_rep';
    }
    return user?.branch === r.fulfillmentBranch
      && ['shipped_to_customer', 'dropped_off_to_customer']
        .includes(r.transferStatus || '');
  }

  const statCards = [
    { label: 'Pending requests', value: stats?.pendingRequests ?? '-' },
    { label: 'Stones requested', value: stats?.stonesRequested ?? '-' },
    { label: 'Duplicate tags', value: stats?.duplicateFlags ?? '-', warn: (stats?.duplicateFlags ?? 0) > 0 },
    { label: 'Fulfilled requests', value: stats?.fulfilledRequests ?? '-', good: true },
    { label: 'Cancelled after ERP check', value: stats?.cancelledRequests ?? '-', warn: (stats?.cancelledRequests ?? 0) > 0 },
  ];

  return (
    <>
      <TopBar title="Requests" branch={branch} onBranch={setBranch} lockBranch={user?.branch || undefined} search={search} onSearch={setSearch} t={t} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 26 }}>
        {rechecks.length > 0 && (
          <div style={{ marginBottom: 20, padding: 16, background: 'oklch(75% 0.14 80 / 0.08)', border: '1px solid oklch(75% 0.14 80 / 0.28)', borderRadius: 12 }}>
            <div style={{ font: "800 13px 'Inter'", color: AMBER }}>LIVE MAITRI ERP RECHECKS — {user?.branch}</div>
            <div style={{ marginTop: 4, font: "500 11px 'Inter'", color: t.textFaint }}>
              These are stones blocked by the morning Excel snapshot. Check Maitri ERP now; this verification does not rewrite the daily stock file.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
              {rechecks.map((recheck) => (
                <div key={recheck.id} style={{ display: 'grid', gridTemplateColumns: '160px minmax(130px,1fr) 120px minmax(340px,auto)', gap: 10, alignItems: 'center', padding: '9px 10px', background: t.bgCard, border: `1px solid ${t.borderLight}`, borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ font: "800 11px 'JetBrains Mono'", color: t.text }}>{recheck.barcode}</span>
                    <button onClick={() => copyBarcode(recheck.barcode)} style={{ padding: '3px 5px', borderRadius: 4, border: `1px solid ${t.borderLight}`, background: t.bgSide, color: t.textMuted, cursor: 'pointer', font: "700 9px 'Inter'" }}>
                      {copiedBarcode === recheck.barcode ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ font: "600 10.5px 'Inter'", color: t.textMuted }}>
                    {recheck.salesRepName || 'Sales rep'} · snapshot {recheck.snapshot.stockStatus?.replaceAll('_', ' ') || 'missing'}
                  </div>
                  <div style={{ font: "600 10px 'Inter'", color: t.textFaint }}>{timeAgo(recheck.requestedAt)}</div>
                  <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button onClick={() => resolveRecheck(recheck, { decision: 'available', note: 'Released and available in live Maitri ERP' })} style={{ padding: '6px 8px', borderRadius: 6, border: 'none', background: ACCENT, color: '#0a0e0d', cursor: 'pointer', font: "800 9.5px 'Inter'" }}>Available now</button>
                    <button onClick={() => resolveRecheck(recheck, { decision: 'unavailable', liveStatus: 'on_hold' })} style={{ padding: '6px 8px', borderRadius: 6, border: `1px solid ${t.borderLight}`, background: t.bgSide, color: AMBER, cursor: 'pointer', font: "700 9.5px 'Inter'" }}>Still on hold</button>
                    <button onClick={() => resolveRecheck(recheck, { decision: 'unavailable', liveStatus: 'on_memo' })} style={{ padding: '6px 8px', borderRadius: 6, border: `1px solid ${t.borderLight}`, background: t.bgSide, color: AMBER, cursor: 'pointer', font: "700 9.5px 'Inter'" }}>On memo</button>
                    <button onClick={() => resolveRecheck(recheck, { decision: 'unavailable', liveStatus: 'in_transit' })} style={{ padding: '6px 8px', borderRadius: 6, border: `1px solid ${t.borderLight}`, background: t.bgSide, color: AMBER, cursor: 'pointer', font: "700 9.5px 'Inter'" }}>In transit</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14, marginBottom: 22 }}>
          {statCards.map((c) => (
            <div key={c.label} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ font: "700 26px 'JetBrains Mono'", color: c.warn ? RED : c.good ? ACCENT : t.text }}>{c.value}</div>
              <div style={{ font: "500 11.5px 'Inter'", color: t.textFaint, marginTop: 4 }}>{c.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <Pill active={sort === 'recent'} onClick={() => setSort('recent')} t={t}>Recent</Pill>
          <Pill active={sort === 'most_stones'} onClick={() => setSort('most_stones')} t={t}>Most stones</Pill>
          <div style={{ width: 1, height: 20, background: t.borderLight, margin: '0 4px' }} />
          <Pill active={view === 'active'} onClick={() => setView('active')} t={t}>Active</Pill>
          <Pill active={view === 'completed'} onClick={() => setView('completed')} t={t}>Completed</Pill>
        </div>

        {loading && requests.length === 0 ? (
          // Only the true first load (or a filter change that empties the
          // list) shows the placeholder. A background refresh after a
          // checkbox toggle keeps the existing rows mounted instead of
          // unmounting the whole list, which was collapsing page height and
          // snapping scroll back to the top on every check/uncheck.
          <Empty t={t}>Loading...</Empty>
        ) : requests.length === 0 ? (
          <Empty t={t}>{view === 'active' ? 'No active requests. New requests from sales reps appear here.' : 'No completed requests yet.'}</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {requestGroups.map((group, groupIndex) => {
              const collapsed = collapsedGroups[group.key];
              const groupStoneCount = group.requests.reduce((sum, req) => sum + req.stoneCount, 0);
              return (
                <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: `3px solid ${groupAccent(group.label)}`, paddingLeft: 6 }}>
                  <button
                    onClick={() => setCollapsedGroups((p) => ({ ...p, [group.key]: !p[group.key] }))}
                    style={{ display: 'grid', gridTemplateColumns: '40px 1fr 130px 34px', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <Avatar name={group.label} color={avatarColor(groupIndex)} size={30} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: "800 13px 'Inter'", color: groupAccent(group.label), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.label}</div>
                      <div style={{ font: "500 10.5px 'Inter'", color: t.textFaint }}>Requests grouped by fulfillment route</div>
                    </div>
                    <div style={{ font: "600 11.5px 'Inter'", color: t.textFaint, textAlign: 'right' }}>
                      {group.requests.length} request{group.requests.length === 1 ? '' : 's'} / {groupStoneCount} stone{groupStoneCount === 1 ? '' : 's'}
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', justifySelf: 'center' }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {!collapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 42 }}>
                      {group.requests.map((r) => {
                        const detail = expanded[r.id];
                        const allChecked = isRequestChecked(r, detail);
                        const documents = requestDocumentState(r);
                        const strictDocuments = Number(r.workflowVersion || 1) >= 2;
                        return (
                          <div key={r.id} style={{ background: t.bgCard, border: `1px solid ${requestTypeStyle(r.requestType).border}`, borderRadius: 12, overflow: 'hidden' }}>
                            <div onClick={() => toggleExpand(r.id)} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) 70px 90px 80px minmax(0,190px)', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer' }}>
                              <button
                                onClick={(event) => { event.stopPropagation(); confirmResolution(r.id); }}
                                disabled={!canResolveItems(r) || Boolean(detail?.resolutionConfirmed || r.resolutionConfirmed)}
                                title="Confirm the request with the items currently checked"
                                style={{ padding: '8px 9px', borderRadius: 7, border: 'none', background: detail?.resolutionConfirmed || r.resolutionConfirmed ? t.bgSide : ACCENT, color: detail?.resolutionConfirmed || r.resolutionConfirmed ? t.textFaint : '#0a0e0d', cursor: !canResolveItems(r) || detail?.resolutionConfirmed || r.resolutionConfirmed ? 'not-allowed' : 'pointer', font: "800 11px 'Inter'" }}
                              >
                                {detail?.resolutionConfirmed || r.resolutionConfirmed ? 'Confirmed' : 'Confirm'}
                              </button>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                                  <div style={{ font: "800 15px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rep.name} <span style={{ color: t.textFaint, fontSize: 12 }}>Request #{r.id}</span></div>
                                  <RequestTypeBadge label={requestTypeLabel(r.requestType)} styleInfo={requestTypeStyle(r.requestType)} />
                                </div>
                                <div style={{ font: "500 11.5px 'Inter'", color: t.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }}>
                                  {hasDeliveryWorkflow(r.crossBranch, r.deliveryRoute) ? `${r.crossBranch ? 'Cross branch' : 'Local delivery'}: ${r.fulfillmentBranch} -> ${r.deliveryBranch} - ${(r.transferStatus || 'awaiting_source').replaceAll('_', ' ')}${r.deliveryRoute === 'customer_ship' ? ` - paperwork: ${documents.paperworkComplete ? r.paperworkType : 'pending'}` : ''}` : requestScopeLabel(r.requestScope)} - {r.source === 'invoice_upload' ? 'via invoice' : 'manual'}{r.requestType === 'dropoff' && r.dropoffCompany ? ` - ${r.dropoffCompany}` : ''}
                                </div>
                              </div>
                              <div style={{ font: "600 12px Arial, sans-serif", color: t.textMuted }}>{r.crossBranch ? r.deliveryBranch : r.branch}</div>
                              <div style={{ font: "400 11.5px 'Inter'", color: t.textFaint }}>{timeAgo(r.requestedAt)}</div>
                              <div style={{ font: "600 12px Arial, sans-serif", color: t.textMuted }}>{r.stoneCount} stone{r.stoneCount === 1 ? '' : 's'}</div>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                                <StatusBadge status={r.status} />
                                {r.deliveryRoute === 'customer_ship' && !documents.paperworkComplete && <span style={{ font: "800 9.5px 'Inter'", color: AMBER, whiteSpace: 'nowrap' }}>PENDING PAPERWORK</span>}
                                {r.deliveryRoute === 'customer_ship' && !r.hasLabel && <span style={{ font: "800 9.5px 'Inter'", color: AMBER, whiteSpace: 'nowrap' }}>PENDING LABEL</span>}
                                {r.hasDuplicate && <DuplicateBadge reps={[]} />}
                              </div>
                            </div>

                            {detail && (
                              <div style={{ borderTop: `1px solid ${t.border}`, background: t.bgSide, overflowX: 'auto' }}>
                                <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: `1px solid ${t.border}`, minWidth: 1040 }}>
                                  <span style={{ font: "800 11px 'Inter'", color: t.text }}>BARCODE SCANNER READY</span>
                                  <span style={{ font: "600 11px 'Inter'", color: t.textFaint }}>Scan a requested physical stone now. No field needs to be selected.</span>
                                  {scanMessage && <span style={{ font: "600 11px 'Inter'", color: t.textFaint }}>{scanMessage}</span>}
                                </div>
                                {hasDeliveryWorkflow(r.crossBranch, r.deliveryRoute) && (
                                  <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 9, borderBottom: `1px solid ${t.border}`, minWidth: 1040 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                      <span style={{ font: "700 12px 'Inter'", color: t.text }}>Physical route: {r.fulfillmentBranch}{' → '}{r.deliveryBranch}</span>
                                      <span style={{ font: "600 11px 'Inter'", color: t.textMuted }}>{r.deliveryRoute?.replaceAll('_', ' ')}</span>
                                      <span style={{ font: "700 10.5px 'Inter'", color: t.textFaint }}>Movement: {(r.transferStatus || 'awaiting_source').replaceAll('_', ' ')}</span>
                                      {transferNext(r, allChecked) && (
                                        <button onClick={() => updateTransfer(r.id, transferNext(r, allChecked)!.action)} style={{ padding: '8px 12px', borderRadius: 7, border: 'none', background: ACCENT, color: '#0a0e0d', cursor: 'pointer', font: "800 11px 'Inter'" }}>
                                          {transferNext(r, allChecked)!.label}
                                        </button>
                                      )}
                                      {['packed', 'ready_for_rep'].includes(r.transferStatus || 'awaiting_source') && !allChecked && <span style={{ font: "700 11px 'Inter'", color: t.textFaint }}>Confirm required items below before final delivery.</span>}
                                    </div>

                                    {r.crossBranch && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: t.bgCard, border: `1px solid ${t.borderLight}`, borderRadius: 8 }}>
                                        <span style={{ font: "800 10.5px 'Inter'", color: t.text }}>MAITRI ERP DIGITAL BT</span>
                                        <span style={{ font: "700 10.5px 'Inter'", color: r.erpTransferConfirmed ? ACCENT : AMBER }}>
                                          {r.fulfillmentBranch} issue: {r.erpTransferConfirmed ? 'completed' : 'waiting'}
                                        </span>
                                        {!r.erpTransferConfirmed && user?.branch === r.fulfillmentBranch && (
                                          <>
                                            <button onClick={() => confirmErpTransfer(r.id)} style={{ padding: '7px 10px', borderRadius: 7, border: 'none', background: AMBER, color: '#0a0e0d', cursor: 'pointer', font: "800 10.5px 'Inter'" }}>Confirm ERP BT issued</button>
                                            <button onClick={() => rejectErpTransfer(r)} style={{ padding: '7px 10px', borderRadius: 7, border: `1px solid ${RED}`, background: 'transparent', color: RED, cursor: 'pointer', font: "800 10.5px 'Inter'" }}>Cannot issue BT</button>
                                          </>
                                        )}
                                        <span style={{ color: t.textFaint }}>→</span>
                                        <span style={{ font: "700 10.5px 'Inter'", color: r.erpTransferReceived ? ACCENT : r.erpReceiveRequested ? AMBER : t.textFaint }}>
                                          {r.deliveryBranch} receipt: {r.erpTransferReceived ? 'completed' : r.erpReceiveRequested ? 'requested by sales rep' : 'not requested'}
                                        </span>
                                        {r.erpTransferConfirmed && !r.erpTransferReceived && user?.branch === r.deliveryBranch && (
                                          <button onClick={() => confirmErpReceived(r.id)} style={{ padding: '7px 10px', borderRadius: 7, border: 'none', background: r.erpReceiveRequested ? AMBER : ACCENT, color: '#0a0e0d', cursor: 'pointer', font: "800 10.5px 'Inter'" }}>Receive ERP BT now</button>
                                        )}
                                        <span style={{ font: "500 9.5px 'Inter'", color: t.textFaint }}>Digital receipt is independent of physical arrival.</span>
                                      </div>
                                    )}

                                    {r.deliveryRoute === 'customer_ship' && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ font: "800 10px 'Inter'", color: documents.paperworkComplete ? ACCENT : AMBER }}>Step 1 paperwork: {documents.paperworkComplete ? r.paperworkType : 'pending'}</span>
                                        {r.hasPaperwork && <button onClick={() => openPaperwork(r.id)} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, cursor: 'pointer', font: "800 10px 'Inter'" }}>Open paperwork</button>}
                                        <span style={{ font: "800 10px 'Inter'", color: r.hasLabel ? ACCENT : AMBER }}>Step 2 label: {r.hasLabel ? 'uploaded' : 'pending'}</span>
                                        {r.hasLabel && <button onClick={() => openShippingLabel(r.id)} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, cursor: 'pointer', font: "800 10px 'Inter'" }}>Open shipping label</button>}
                                        {strictDocuments && r.crossBranch && !r.erpTransferReceived && <span style={{ font: "700 10px 'Inter'", color: AMBER }}>ERP receipt is required before customer paperwork and shipment.</span>}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div style={{ minWidth: 1040 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: STONE_TABLE_COLS, gap: 12, padding: '12px 18px', font: "800 11.5px 'Inter'", color: t.textFainter, letterSpacing: '0.04em' }}>
                                  <div title="Mark every requested stone found" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}><span>STN</span><Check checked={detail.stones.every((stone) => stone.stone_found)} onClick={() => checkAll(r.id, !detail.stones.every((stone) => stone.stone_found), 'stone_found')} disabled={r.requestScope === 'cert_only' || !canResolveItems(r)} size={18} /></div>
                                  <div title="Mark every requested certificate found" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}><span>CERT</span><Check checked={detail.stones.every((stone) => stone.cert_found)} onClick={() => checkAll(r.id, !detail.stones.every((stone) => stone.cert_found), 'cert_found')} disabled={r.requestScope === 'stone_only' || !canResolveItems(r)} size={18} /></div>
                                  <div title="Mark every requested item returned" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}><span>RET</span><Check checked={detail.stones.every((stone) => stone.returned)} onClick={() => checkAll(r.id, !detail.stones.every((stone) => stone.returned), 'returned')} disabled={!canMarkReturned(r)} accent="oklch(75% 0.13 250)" size={18} /></div>
                                  <div>STOCK #</div><div>SHAPE</div><div>CARAT</div><div>COL</div><div>CLTY</div><div>CERT #</div>
                                </div>
                                {detail.stones.map((s) => (
                                  <div key={s.id} style={{ display: 'grid', gridTemplateColumns: STONE_TABLE_COLS, gap: 12, padding: '13px 18px', alignItems: 'center', minHeight: 52, borderTop: `1px solid ${t.rowBorder}`, background: s.duplicate ? 'oklch(70% 0.17 30 / 0.08)' : 'transparent' }}>
                                    <Check checked={s.stone_found} onClick={() => toggleStone(r.id, s, 'stone_found')} size={24} disabled={r.requestScope === 'cert_only' || !canResolveItems(r)} />
                                    <Check checked={s.cert_found} onClick={() => toggleStone(r.id, s, 'cert_found')} size={24} disabled={r.requestScope === 'stone_only' || !canResolveItems(r)} />
                                    <Check checked={s.returned} onClick={() => toggleStone(r.id, s, 'returned')} size={24} disabled={!canMarkReturned(r)} accent="oklch(75% 0.13 250)" />
                                    <div style={{ font: "700 14px Arial, sans-serif", color: t.text, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.barcode}</span>
                                      <button
                                        onClick={() => copyBarcode(s.barcode)}
                                        title={`Copy ${s.barcode}`}
                                        style={{ flex: 'none', padding: '4px 7px', borderRadius: 5, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: copiedBarcode === s.barcode ? ACCENT : t.textMuted, cursor: 'pointer', font: "700 9.5px 'Inter'" }}
                                      >
                                        {copiedBarcode === s.barcode ? 'Copied' : 'Copy barcode'}
                                      </button>
                                      {s.duplicate && <span title={`Also held by: ${s.duplicateWith?.join(', ')}`} style={{ color: RED, flex: 'none' }}>!</span>}
                                    </div>
                                    <div style={{ font: "700 14px 'Inter'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.item_type === 'jewelry' ? (s.item || s.category || 'Jewelry') : (s.shape || '-')}</div>
                                    <div style={{ font: "700 14px Arial, sans-serif", color: t.text }}>{s.item_type === 'jewelry' ? `${fmtCarat(s.carat)} d.cts` : fmtCarat(s.carat)}</div>
                                    <div style={{ font: "700 14px Arial, sans-serif", color: t.text }}>{s.color || '-'}</div>
                                    <div style={{ font: "700 14px Arial, sans-serif", color: t.text }}>{s.clarity || '-'}</div>
                                    <div style={{ font: "700 13.5px Arial, sans-serif", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.cert_no || '-'}</div>
                                  </div>
                                ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function Pill({ active, onClick, children, t }: { active: boolean; onClick: () => void; children: React.ReactNode; t: import('@/lib/theme').Theme }) {
  return (
    <button onClick={onClick} style={{ cursor: 'pointer', font: "600 11.5px 'Inter'", padding: '6px 13px', borderRadius: 20, background: active ? 'oklch(78% 0.13 240 / 0.18)' : t.bgCard, color: active ? ACCENT : t.textMuted, border: `1px solid ${active ? 'oklch(78% 0.13 240 / 0.3)' : t.borderLight}` }}>
      {children}
    </button>
  );
}

function RequestTypeBadge({ label, styleInfo }: { label: string; styleInfo: { bg: string; border: string; text: string } }) {
  return (
    <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 26, padding: '4px 11px', borderRadius: 7, background: styleInfo.bg, border: `1px solid ${styleInfo.border}`, color: styleInfo.text, font: "800 13px 'Inter'", letterSpacing: '0.02em', textTransform: 'uppercase' }}>
      {label}
    </span>
  );
}

function Empty({ children, t }: { children: React.ReactNode; t: import('@/lib/theme').Theme }) {
  return <div style={{ padding: 60, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFainter }}>{children}</div>;
}
