'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, MyRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranchSocket } from '@/lib/socket';
import { useTheme } from '../repContext';
import { ACCENT, AMBER, GREEN, RED } from '@/lib/theme';
import { timeAgo, fmtCarat, sortStonesClient, STATUS_LABELS } from '@/lib/utils';
import { Check, Copyable } from '@/components/ui';
import {
  documentStepState,
  hasDeliveryWorkflow,
} from '@/lib/requestWorkflow';

type PaperworkUpload = {
  requestId: number;
  paperworkType: 'invoice' | 'memo';
};

const actionButton = {
  padding: '7px 10px',
  borderRadius: 7,
  cursor: 'pointer',
  font: "700 12.5px 'Inter'",
} as const;

export default function MyRequestsPage() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [labelFor, setLabelFor] = useState<number | null>(null);
  const [paperworkFor, setPaperworkFor] = useState<PaperworkUpload | null>(null);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const paperworkInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!user?.salesRepId) return;
    setLoading(true);
    try {
      setRequests(await api.myRequests(user.salesRepId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load your requests.');
      setMessageError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);
  useBranchSocket(user?.branch || 'NY', () => load());

  function showMessage(text: string, error = false) {
    setMessage(text);
    setMessageError(error);
  }

  async function uploadLabel(file: File) {
    if (!labelFor) return;
    const requestId = labelFor;
    try {
      await api.uploadShippingLabel(requestId, file);
      showMessage(`Step 2 complete: shipping label saved for request #${requestId}.`);
      await load();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not upload the shipping label.', true);
    } finally {
      setLabelFor(null);
      if (labelInputRef.current) labelInputRef.current.value = '';
    }
  }

  async function uploadPaperwork(file: File) {
    if (!paperworkFor) return;
    const target = paperworkFor;
    try {
      await api.uploadPaperwork(target.requestId, target.paperworkType, file);
      showMessage(`Step 1 complete: ${target.paperworkType} saved for request #${target.requestId}.`);
      await load();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not upload the paperwork.', true);
    } finally {
      setPaperworkFor(null);
      if (paperworkInputRef.current) paperworkInputRef.current.value = '';
    }
  }

  async function requestErpReceipt(request: MyRequest) {
    if (!request.erpTransferConfirmed) {
      showMessage(`Wait for ${request.fulfillmentBranch} inventory to issue the ERP BT first.`, true);
      return;
    }
    try {
      await api.requestErpReceive(request.id);
      showMessage(`${request.deliveryBranch} inventory was asked to receive ERP BT for request #${request.id}.`);
      await load();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not request ERP BT receipt.', true);
    }
  }

  async function updateLegacyPaperworkDecision(
    requestId: number,
    paperworkType: 'none' | 'invoice' | 'memo'
  ) {
    try {
      await api.setPaperworkType(requestId, paperworkType);
      showMessage(`Paperwork choice saved for request #${requestId}.`);
      await load();
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : 'Could not save the paperwork choice.',
        true
      );
    }
  }

  async function openDocument(
    requestId: number,
    kind: 'paperwork' | 'label'
  ) {
    try {
      const url = kind === 'paperwork'
        ? await api.paperworkUrl(requestId)
        : await api.shippingLabelUrl(requestId);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : `Could not open ${kind}.`, true);
    }
  }

  function startPaperwork(
    requestId: number,
    paperworkType: 'invoice' | 'memo'
  ) {
    setPaperworkFor({ requestId, paperworkType });
    paperworkInputRef.current?.click();
  }

  const statusColor = (status: string) => {
    if (status === 'fulfilled') return GREEN;
    if (status === 'cancelled') return RED;
    return AMBER;
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '20px 26px 14px' }}>
        <div style={{ font: "700 20px 'Inter'", color: t.text }}>My requests</div>
        <div style={{ font: "400 14px 'Inter'", color: t.textFaint, marginTop: 3 }}>
          Physical movement, ERP branch transfer, and customer documents are tracked separately.
        </div>
      </div>
      <input
        ref={labelInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) uploadLabel(file);
        }}
      />
      <input
        ref={paperworkInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) uploadPaperwork(file);
        }}
      />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 26px 26px' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', font: "400 15px 'Inter'", color: t.textFaint }}>Loading…</div>
        ) : requests.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', font: "400 15px 'Inter'", color: t.textFaint }}>You haven&apos;t submitted any requests yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.map((request) => {
              const isOpen = open[request.id];
              const deliveryWorkflow = hasDeliveryWorkflow(
                request.crossBranch,
                request.deliveryRoute
              );
              const customerShipment = request.deliveryRoute === 'customer_ship';
              const strictDocuments = Number(request.workflowVersion || 1) >= 2;
              const documentState = documentStepState({
                workflowVersion: request.workflowVersion,
                crossBranch: request.crossBranch,
                erpTransferReceived: request.erpTransferReceived,
                paperworkType: request.paperworkType,
                hasPaperwork: request.hasPaperwork,
                hasLabel: request.hasLabel,
              });
              const pendingPaperwork = customerShipment
                && !documentState.paperworkComplete;
              const pendingLabel = customerShipment && !request.hasLabel;
              const canEditDocuments = ['awaiting_source', 'packed']
                .includes(request.transferStatus || 'awaiting_source')
                && request.status !== 'cancelled';

              return (
                <div key={request.id} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div
                    onClick={() => setOpen((current) => ({
                      ...current,
                      [request.id]: !current[request.id],
                    }))}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 120px 34px', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: "600 15px 'Inter'", color: t.text }}>Request #{request.id}</div>
                      {(pendingPaperwork || pendingLabel) && request.status !== 'cancelled' && (
                        <div style={{ display: 'flex', gap: 7, marginTop: 4, flexWrap: 'wrap' }}>
                          {pendingPaperwork && <span style={{ font: "800 11.5px 'Inter'", color: AMBER }}>STEP 1 PAPERWORK</span>}
                          {pendingLabel && <span style={{ font: "800 11.5px 'Inter'", color: AMBER }}>STEP 2 LABEL</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ font: "500 13.5px 'JetBrains Mono'", color: t.textMuted }}>{request.branch}</div>
                    <div style={{ font: "400 13.5px 'Inter'", color: t.textFaint }}>{timeAgo(request.requestedAt)}</div>
                    <div style={{ font: "600 12.5px 'Inter'", color: statusColor(request.status) }}>
                      {STATUS_LABELS[request.status] || request.status}
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="M6 9l6 6 6-6" /></svg>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${t.border}` }}>
                      {request.status === 'cancelled' && (
                        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${t.border}`, color: RED, font: "700 13px 'Inter'" }}>
                          Cancelled after live ERP check: {request.cancellationStatus?.replaceAll('_', ' ') || 'unavailable'}
                          {request.cancellationReason ? ` — ${request.cancellationReason}` : ''}
                        </div>
                      )}

                      {deliveryWorkflow && (
                        <div style={{ padding: '11px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: "600 13px 'Inter'", color: t.textMuted }}>
                            <span>Physical route: {request.fulfillmentBranch || request.branch} → {request.deliveryBranch || request.branch}</span>
                            <span>{request.deliveryRoute === 'internal_transfer' ? 'Office shipment' : request.deliveryRoute === 'customer_ship' ? 'Customer shipment' : 'Customer drop-off'}</span>
                            <span>Movement: {request.transferStatus?.replaceAll('_', ' ') || 'awaiting source'}</span>
                          </div>

                          {request.crossBranch && (
                            <div style={{ padding: 10, background: t.bgSide, border: `1px solid ${t.borderLight}`, borderRadius: 8 }}>
                              <div style={{ font: "800 12.5px 'Inter'", color: t.text }}>MAITRI ERP — DIGITAL BRANCH TRANSFER</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                <span style={{ font: "700 12.5px 'Inter'", color: request.erpTransferConfirmed ? GREEN : AMBER }}>
                                  1. {request.fulfillmentBranch} issue BT: {request.erpTransferConfirmed ? 'Completed' : 'Waiting'}
                                </span>
                                <span style={{ color: t.textFaint }}>→</span>
                                <span style={{ font: "700 12.5px 'Inter'", color: request.erpTransferReceived ? GREEN : AMBER }}>
                                  2. {request.deliveryBranch} receive BT: {request.erpTransferReceived ? 'Completed' : request.erpReceiveRequested ? 'Requested' : 'Not requested'}
                                </span>
                                {!request.erpTransferReceived && request.status !== 'cancelled' && (
                                  <button
                                    onClick={() => requestErpReceipt(request)}
                                    disabled={!request.erpTransferConfirmed || request.erpReceiveRequested}
                                    style={{
                                      ...actionButton,
                                      border: 'none',
                                      background: request.erpTransferConfirmed && !request.erpReceiveRequested ? ACCENT : t.chipBg,
                                      color: request.erpTransferConfirmed && !request.erpReceiveRequested ? '#0a0e0d' : t.textFaint,
                                      cursor: request.erpTransferConfirmed && !request.erpReceiveRequested ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    {request.erpReceiveRequested ? 'Receipt requested' : `Ask ${request.deliveryBranch} to receive ERP BT`}
                                  </button>
                                )}
                              </div>
                              <div style={{ marginTop: 7, font: "500 12px 'Inter'", color: t.textFaint }}>
                                ERP receipt can be completed when you need to create the invoice or memo; physical arrival is tracked separately.
                              </div>
                            </div>
                          )}

                          {customerShipment && (
                            <div style={{ padding: 10, background: t.bgSide, border: `1px solid ${t.borderLight}`, borderRadius: 8 }}>
                              <div style={{ font: "800 12.5px 'Inter'", color: t.text }}>CUSTOMER SHIPMENT DOCUMENTS</div>
                              {!documentState.paperworkEnabled && (
                                <div style={{ marginTop: 6, font: "600 12px 'Inter'", color: AMBER }}>
                                  Receive the ERP BT first so the invoice or memo can be created in {request.deliveryBranch}.
                                </div>
                              )}
                              {strictDocuments ? (
                                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
                                  <span style={{ font: "800 12px 'Inter'", color: request.hasPaperwork ? GREEN : AMBER }}>
                                    Step 1: {request.hasPaperwork ? `${request.paperworkType} uploaded` : 'invoice/memo required'}
                                  </span>
                                  {request.hasPaperwork && (
                                    <button onClick={() => openDocument(request.id, 'paperwork')} style={{ ...actionButton, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: t.text }}>Open paperwork</button>
                                  )}
                                  {canEditDocuments && documentState.paperworkEnabled && (
                                    <>
                                      <button onClick={() => startPaperwork(request.id, 'invoice')} style={{ ...actionButton, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: t.text }}>{request.hasPaperwork ? 'Replace with invoice' : 'Upload invoice'}</button>
                                      <button onClick={() => startPaperwork(request.id, 'memo')} style={{ ...actionButton, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: t.text }}>{request.hasPaperwork ? 'Replace with memo' : 'Upload memo'}</button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                                  <span style={{ font: "800 12px 'Inter'", color: documentState.paperworkComplete ? GREEN : AMBER }}>
                                    Legacy paperwork choice: {request.paperworkType || 'pending'}
                                  </span>
                                  {canEditDocuments && (['none', 'invoice', 'memo'] as const).map((choice) => (
                                    <button
                                      key={choice}
                                      onClick={() => updateLegacyPaperworkDecision(request.id, choice)}
                                      style={{
                                        ...actionButton,
                                        border: `1px solid ${request.paperworkType === choice ? ACCENT : t.borderLight}`,
                                        background: request.paperworkType === choice ? 'oklch(78% 0.13 240 / 0.14)' : t.bgCard,
                                        color: request.paperworkType === choice ? ACCENT : t.text,
                                      }}
                                    >
                                      {choice === 'none' ? 'No paperwork' : choice[0].toUpperCase() + choice.slice(1)}
                                    </button>
                                  ))}
                                  {request.hasPaperwork && (
                                    <button onClick={() => openDocument(request.id, 'paperwork')} style={{ ...actionButton, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: t.text }}>Open attached file</button>
                                  )}
                                  {canEditDocuments && ['invoice', 'memo'].includes(request.paperworkType || '') && (
                                    <button
                                      onClick={() => startPaperwork(request.id, request.paperworkType as 'invoice' | 'memo')}
                                      style={{ ...actionButton, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: t.text }}
                                    >
                                      {request.hasPaperwork ? 'Replace optional file' : 'Attach optional file'}
                                    </button>
                                  )}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
                                <span style={{ font: "800 12px 'Inter'", color: request.hasLabel ? GREEN : AMBER }}>
                                  Step 2: {request.hasLabel ? 'shipping label uploaded' : 'shipping label required'}
                                </span>
                                {request.hasLabel && (
                                  <button onClick={() => openDocument(request.id, 'label')} style={{ ...actionButton, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: t.text }}>Open label</button>
                                )}
                                {canEditDocuments && documentState.labelEnabled && (
                                  <button
                                    onClick={() => {
                                      setLabelFor(request.id);
                                      labelInputRef.current?.click();
                                    }}
                                    style={{ ...actionButton, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: t.text }}
                                  >
                                    {request.hasLabel ? 'Replace shipping label' : 'Upload shipping label'}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 90px 70px 50px 60px 44px 44px', gap: 8, padding: '9px 16px', font: "600 11.5px 'Inter'", color: t.textFaint }}>
                        <div>STOCK #</div><div>SHAPE</div><div>CARAT</div><div>COL</div><div>CLTY</div><div title="Stone found">STN</div><div title="Cert found">CRT</div>
                      </div>
                      {sortStonesClient(request.stones).map((stone) => (
                        <div key={stone.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 90px 70px 50px 60px 44px 44px', gap: 8, padding: '9px 16px', alignItems: 'center', borderTop: `1px solid ${t.rowBorder}` }}>
                          <div style={{ minWidth: 0 }}>
                            <Copyable value={stone.barcode} style={{ font: "500 13.5px 'JetBrains Mono'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                            {stone.liveErpVerification && <div style={{ font: "700 11px 'Inter'", color: GREEN }}>Live ERP availability verified</div>}
                            {stone.snapshotReconciliation?.state === 'mismatch' && <div style={{ font: "700 11px 'Inter'", color: RED }}>Snapshot needs inventory review</div>}
                          </div>
                          <div style={{ font: "400 13.5px 'Inter'", color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stone.item_type === 'jewelry' ? (stone.item || stone.category || 'Jewelry') : (stone.shape || '—')}</div>
                          <div style={{ font: "500 13.5px 'JetBrains Mono'", color: t.textMuted }}>{stone.item_type === 'jewelry' ? `${fmtCarat(stone.carat)} d.cts` : fmtCarat(stone.carat)}</div>
                          <div style={{ font: "500 13.5px 'JetBrains Mono'", color: t.text }}>{stone.color || '—'}</div>
                          <div style={{ font: "500 13.5px 'JetBrains Mono'", color: t.text }}>{stone.clarity || '—'}</div>
                          <Check checked={stone.stone_found} disabled size={16} />
                          <Check checked={stone.cert_found} disabled size={16} />
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

      {message && (
        <div style={{ position: 'fixed', right: 22, bottom: 22, maxWidth: 440, padding: '10px 13px', background: t.bgCard, border: `1px solid ${messageError ? RED : t.border}`, borderRadius: 8, color: messageError ? RED : t.text, font: "600 14px 'Inter'", zIndex: 100 }}>
          {message}
        </div>
      )}
    </div>
  );
}
