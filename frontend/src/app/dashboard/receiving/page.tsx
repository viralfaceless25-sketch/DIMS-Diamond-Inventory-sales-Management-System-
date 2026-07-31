'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  ReceiptCandidate,
  ReceiptLookup,
  ReceiptStatus,
  ShipmentReceipt,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/ThemeProvider';
import { useBranchSocket } from '@/lib/socket';
import { Copyable } from '@/components/ui';
import { ACCENT, AMBER, GREEN, RED } from '@/lib/theme';
import { extractBarcodes } from '@/lib/utils';
import {
  branchToday,
  componentSummary,
  defaultCandidateId,
  defaultComponents,
  elsewhereMessage,
  receiptFormReady,
  shiftIsoDate,
} from '@/lib/receiving';

type BatchRow = {
  key: string;
  barcode: string;
  loading: boolean;
  candidates: ReceiptCandidate[];
  previousCount: number;
  elsewhereNote: string;
  requestStoneId: number | null;
  sourceBranch: string;
  stoneReceived: boolean;
  certReceived: boolean;
  note: string;
  saved: boolean;
  error: string;
};

const BRANCHES = ['NY', 'LA', 'CH'];
const STATUSES: ReceiptStatus[] = [
  'Needs review',
  'Partial arrival',
  'Ready for rep',
  'Handed over',
];

function Choice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <div>
      <div style={{ font: "700 11px 'Inter'", marginBottom: 7 }}>{label}</div>
      <div style={{ display: 'flex', gap: 7 }}>
        {[true, false].map((choice) => (
          <button
            key={String(choice)}
            type="button"
            onClick={() => onChange(choice)}
            style={{
              minWidth: 72,
              padding: '9px 15px',
              borderRadius: 8,
              border: `1px solid ${value === choice ? ACCENT : '#d9d7d0'}`,
              background: value === choice ? 'oklch(78% 0.13 240 / 0.16)' : 'transparent',
              color: value === choice ? ACCENT : 'inherit',
              font: "700 12px 'Inter'",
              cursor: 'pointer',
            }}
          >
            {choice ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ReceiptStatus }) {
  const color = status === 'Ready for rep'
    ? GREEN
    : status === 'Handed over'
      ? ACCENT
      : status === 'Needs review'
        ? RED
        : AMBER;
  return (
    <span style={{
      color,
      border: `1px solid ${color.replace(')', ' / 0.32)')}`,
      background: color.replace(')', ' / 0.12)'),
      borderRadius: 20,
      padding: '4px 9px',
      font: "700 10.5px 'Inter'",
      whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}

function CandidateCard({
  candidate,
  selected,
  onSelect,
}: {
  candidate: ReceiptCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '11px 12px',
        borderRadius: 9,
        border: `1px solid ${selected ? ACCENT : '#dedbd4'}`,
        background: selected ? 'oklch(78% 0.13 240 / 0.12)' : 'transparent',
        cursor: 'pointer',
        color: 'inherit',
      }}
    >
      <div style={{ font: "700 12px 'Inter'" }}>
        Request #{candidate.requestId} · Give to {candidate.rep.name}
      </div>
      <div style={{ font: "500 11px 'Inter'", opacity: 0.67, marginTop: 4 }}>
        {candidate.sourceBranch} → {candidate.destinationBranch} · {candidate.requestScope.replaceAll('_', ' ')}
      </div>
    </button>
  );
}

export default function ReceivingPage() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const branch = user?.branch || 'NY';
  const today = useMemo(() => branchToday(branch), [branch]);
  const [date, setDate] = useState(today);
  const [history, setHistory] = useState<ShipmentReceipt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReceiptStatus | ''>('');

  const [barcode, setBarcode] = useState('');
  const [lookup, setLookup] = useState<ReceiptLookup | null>(null);
  const [requestStoneId, setRequestStoneId] = useState<number | null>(null);
  const [sourceBranch, setSourceBranch] = useState('');
  const [stoneReceived, setStoneReceived] = useState<boolean | null>(null);
  const [certReceived, setCertReceived] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<ShipmentReceipt | null>(null);
  const [editStone, setEditStone] = useState(false);
  const [editCert, setEditCert] = useState(false);
  const [editSource, setEditSource] = useState('');
  const [editNote, setEditNote] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  // Batch scanning: one popup collects many barcodes, matches each request
  // individually, and saves one receipt per barcode via the same endpoint the
  // single scan uses. Physical receipt still never touches the ERP BT state.
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchScan, setBatchScan] = useState('');
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchScanning, setBatchScanning] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const batchScanRef = useRef<HTMLInputElement>(null);

  const historyParams = useMemo(() => ({
    date,
    search,
    sourceBranch: sourceFilter,
    status: statusFilter,
  }), [date, search, sourceFilter, statusFilter]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const result = await api.receiptHistory(historyParams);
      setHistory(result.rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load received shipments.');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyParams]);

  useEffect(() => {
    const timer = window.setTimeout(loadHistory, search ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory, search]);

  useBranchSocket(branch, (event) => {
    if (event === 'receipt:updated' || event.startsWith('request:')) loadHistory();
  });

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  function resetScan() {
    setBarcode('');
    setLookup(null);
    setRequestStoneId(null);
    setSourceBranch('');
    setStoneReceived(null);
    setCertReceived(null);
    setNote('');
    window.setTimeout(() => scanRef.current?.focus(), 0);
  }

  async function findBarcode(event?: FormEvent) {
    event?.preventDefault();
    const found = extractBarcodes(barcode);
    if (!found.length) return;
    if (found.length > 1) {
      // More than one barcode was pasted/scanned into the single-item box —
      // that's a batch, not a single lookup. addBatchScan does its own
      // extraction, so the raw text can be handed to it directly.
      const raw = barcode;
      setBarcode('');
      openBatch();
      void addBatchScan(raw);
      return;
    }
    const normalized = found[0];
    setScanLoading(true);
    setMessage('');
    try {
      const result = await api.receiptLookup(normalized);
      setBarcode(result.barcode);
      setLookup(result);
      const selectedId = defaultCandidateId(result.candidates);
      setRequestStoneId(selectedId);
      setSourceBranch(
        selectedId
          ? result.candidates.find((candidate) => candidate.requestStoneId === selectedId)?.sourceBranch || ''
          : ''
      );
      setStoneReceived(null);
      setCertReceived(null);
      if (!result.candidates.length) {
        setMessage(elsewhereMessage(result.elsewhere));
      } else if (result.candidates.length > 1) {
        setMessage('More than one request matched. Select the correct sales rep before saving.');
      }
    } catch (error) {
      setLookup(null);
      setMessage(error instanceof Error ? error.message : 'Could not look up this barcode.');
    } finally {
      setScanLoading(false);
    }
  }

  const selectedCandidate = lookup?.candidates.find(
    (candidate) => candidate.requestStoneId === requestStoneId
  ) || null;
  const canSave = Boolean(lookup) && receiptFormReady({
    barcode,
    stoneReceived,
    certReceived,
    candidateCount: lookup?.candidates.length || 0,
    requestStoneId,
    sourceBranch,
    receivingBranch: branch,
  });

  async function createReceipt(duplicateOverride = false) {
    if (!lookup || stoneReceived == null || certReceived == null) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await api.createReceipt({
        barcode,
        stoneReceived,
        certReceived,
        ...(requestStoneId ? { requestStoneId } : { sourceBranch }),
        duplicateOverride,
        note: note.trim() || undefined,
      });
      setMessage(
        result.rep
          ? `${result.barcode} received. Give it to ${result.rep.name}.`
          : `${result.barcode} saved as Unmatched - Needs Review.`
      );
      resetScan();
      await loadHistory();
    } catch (error) {
      if (
        error instanceof ApiError
        && error.status === 409
        && !duplicateOverride
        && window.confirm(`${error.message}\n\nSave this as a genuine duplicate package?`)
      ) {
        setSaving(false);
        await createReceipt(true);
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not save this receipt.');
    } finally {
      setSaving(false);
    }
  }

  function openBatch(seed?: string) {
    setBatchOpen(true);
    setMessage('');
    window.setTimeout(() => batchScanRef.current?.focus(), 0);
    if (seed) void addBatchScan(seed);
  }

  function updateRow(key: string, patch: Partial<BatchRow>) {
    setBatchRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setBatchRows((rows) => rows.filter((row) => row.key !== key));
  }

  // Accepts one scan OR a whole pasted block containing several barcodes
  // (space/newline/comma-separated, mixed with other invoice text) — every
  // Maitri-shaped barcode found is added as its own row and looked up.
  async function addBatchScan(raw: string) {
    setBatchScan('');
    const barcodes = extractBarcodes(raw);
    if (!barcodes.length) return;
    const skipped: string[] = [];
    for (const normalized of barcodes) {
      const existing = batchRows.find((row) => row.barcode === normalized && !row.saved);
      if (existing) { skipped.push(normalized); continue; }
      await addOneBatchBarcode(normalized);
    }
    if (skipped.length) {
      setMessage(`${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} already in this batch.`);
    }
  }

  async function addOneBatchBarcode(normalized: string) {
    const key = `${normalized}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setBatchRows((rows) => [
      ...rows,
      { key, barcode: normalized, loading: true, candidates: [], previousCount: 0, elsewhereNote: '', requestStoneId: null, sourceBranch: '', stoneReceived: true, certReceived: true, note: '', saved: false, error: '' },
    ]);
    setBatchScanning(true);
    try {
      const result = await api.receiptLookup(normalized);
      const selectedId = defaultCandidateId(result.candidates);
      const chosen = result.candidates.find((candidate) => candidate.requestStoneId === selectedId) || null;
      const scope = chosen?.requestScope;
      const components = defaultComponents(scope);
      updateRow(key, {
        loading: false,
        candidates: result.candidates,
        previousCount: result.previousReceipts.length,
        elsewhereNote: result.candidates.length === 0 ? elsewhereMessage(result.elsewhere) : '',
        requestStoneId: selectedId,
        sourceBranch: chosen?.sourceBranch || '',
        stoneReceived: components.stoneReceived,
        certReceived: components.certReceived,
      });
    } catch (error) {
      updateRow(key, { loading: false, error: error instanceof Error ? error.message : 'Lookup failed' });
    } finally {
      setBatchScanning(false);
      window.setTimeout(() => batchScanRef.current?.focus(), 0);
    }
  }

  function batchRowFormState(row: BatchRow) {
    return {
      barcode: row.barcode,
      stoneReceived: row.stoneReceived,
      certReceived: row.certReceived,
      candidateCount: row.candidates.length,
      requestStoneId: row.requestStoneId,
      sourceBranch: row.sourceBranch,
      receivingBranch: branch,
    };
  }

  async function saveBatch() {
    const pending = batchRows.filter((row) => !row.saved && !row.loading);
    if (!pending.length) return;
    setBatchSaving(true);
    setMessage('');
    let savedCount = 0;
    let failedCount = 0;
    for (const row of pending) {
      if (!receiptFormReady(batchRowFormState(row))) {
        updateRow(row.key, { error: 'Mark Stone/Cert and pick a request or sending branch.' });
        failedCount += 1;
        continue;
      }
      try {
        await api.createReceipt({
          barcode: row.barcode,
          stoneReceived: row.stoneReceived,
          certReceived: row.certReceived,
          ...(row.requestStoneId ? { requestStoneId: row.requestStoneId } : { sourceBranch: row.sourceBranch }),
          duplicateOverride: allowDuplicates,
          note: row.note.trim() || undefined,
        });
        updateRow(row.key, { saved: true, error: '' });
        savedCount += 1;
      } catch (error) {
        const dup = error instanceof ApiError && error.status === 409;
        updateRow(row.key, {
          error: dup
            ? 'Looks like a duplicate. Tick "Allow duplicates" to save it, or remove it.'
            : error instanceof Error ? error.message : 'Could not save.',
        });
        failedCount += 1;
      }
    }
    setBatchSaving(false);
    await loadHistory();
    if (failedCount === 0) {
      setMessage(`Saved ${savedCount} scanned ${savedCount === 1 ? 'item' : 'items'}.`);
      setBatchRows([]);
      setBatchOpen(false);
      setAllowDuplicates(false);
    } else {
      setMessage(`Saved ${savedCount}; ${failedCount} still need attention below.`);
    }
  }

  function closeBatch() {
    setBatchOpen(false);
    setBatchRows([]);
    setBatchScan('');
    setAllowDuplicates(false);
    window.setTimeout(() => scanRef.current?.focus(), 0);
  }

  async function handoff(row: ShipmentReceipt) {
    if (!row.requestId || !row.rep) return;
    if (!window.confirm(`Confirm all received items for request #${row.requestId} were handed to ${row.rep.name}?`)) return;
    try {
      await api.handReceiptToRep(row.requestId);
      setMessage(`Request #${row.requestId} handed to ${row.rep.name}.`);
      await loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not record the handoff.');
    }
  }

  async function matchReceipt(row: ShipmentReceipt) {
    try {
      const result = await api.receiptLookup(row.barcode);
      if (!result.candidates.length) {
        setMessage(elsewhereMessage(result.elsewhere));
        return;
      }
      let candidate = result.candidates[0];
      if (result.candidates.length > 1) {
        const choice = window.prompt(
          `Enter the correct request number:\n${result.candidates.map((item) => `#${item.requestId} — ${item.rep.name}`).join('\n')}`,
          String(candidate.requestId)
        );
        candidate = result.candidates.find((item) => String(item.requestId) === choice) || candidate;
      }
      await api.linkReceipt(row.id, candidate.requestStoneId);
      setMessage(`${row.barcode} linked to request #${candidate.requestId} for ${candidate.rep.name}.`);
      await loadHistory();
    } catch (error) {
      if (
        error instanceof ApiError
        && error.status === 409
        && window.confirm(`${error.message}\n\nLink as a genuine duplicate package?`)
      ) {
        const result = await api.receiptLookup(row.barcode);
        if (result.candidates.length === 1) {
          await api.linkReceipt(row.id, result.candidates[0].requestStoneId, true);
          await loadHistory();
        }
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not match this receipt.');
    }
  }

  function beginCorrection(row: ShipmentReceipt) {
    setEditing(row);
    setEditStone(row.stoneReceived);
    setEditCert(row.certReceived);
    setEditSource(row.sourceBranch);
    setEditNote(row.note || '');
  }

  async function saveCorrection(duplicateOverride = false) {
    if (!editing || (!editStone && !editCert)) return;
    try {
      await api.correctReceipt(editing.id, {
        stoneReceived: editStone,
        certReceived: editCert,
        sourceBranch: editSource,
        duplicateOverride,
        note: editNote.trim() || undefined,
      });
      setMessage(`${editing.barcode} corrected. The audit history was preserved.`);
      setEditing(null);
      await loadHistory();
    } catch (error) {
      if (
        error instanceof ApiError
        && error.status === 409
        && !duplicateOverride
        && window.confirm(`${error.message}\n\nSave as a genuine duplicate package?`)
      ) {
        await saveCorrection(true);
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not correct this receipt.');
    }
  }

  async function exportDay() {
    try {
      const blob = await api.receiptExport(historyParams);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Received-from-Branch-${branch}-${date}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not export this day.');
    }
  }

  const card = {
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    borderRadius: 12,
  };
  const inputStyle = {
    background: t.bg,
    color: t.text,
    border: `1px solid ${t.borderLight}`,
    borderRadius: 8,
    outline: 'none',
    padding: '10px 12px',
    font: "600 13px 'Inter'",
  };

  return (
    <>
      <div style={{ height: 64, flex: 'none', padding: '0 26px', display: 'flex', alignItems: 'center', gap: 12, background: t.bgSide, borderBottom: `1px solid ${t.border}` }}>
        <div style={{ font: "700 16px 'Inter'" }}>Receive Shipments</div>
        <span style={{ padding: '5px 10px', borderRadius: 20, background: 'oklch(78% 0.13 240 / 0.14)', color: ACCENT, font: "700 11px 'Inter'" }}>
          Receiving at {branch}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ font: "500 11px 'Inter'", color: t.textFaint }}>
          Physical receipt only · Maitri ERP BT stays separate
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 26 }}>
        {message && (
          <div role="status" style={{ marginBottom: 14, padding: '11px 13px', borderRadius: 9, background: 'oklch(78% 0.13 240 / 0.12)', border: `1px solid ${ACCENT.replace(')', ' / 0.3)')}`, color: t.text, font: "600 12px 'Inter'" }}>
            {message}
          </div>
        )}

        <div style={{ ...card, padding: 18, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 360px' }}>
              <div style={{ font: "700 15px 'Inter'", marginBottom: 4 }}>Scan received stone or certificate</div>
              <div style={{ font: "500 11px 'Inter'", color: t.textFaint, marginBottom: 12 }}>
                The same barcode is used for both. Scan once, then mark exactly what arrived.
              </div>
              <form onSubmit={findBarcode} style={{ display: 'flex', gap: 8 }}>
                <input
                  ref={scanRef}
                  value={barcode}
                  onChange={(event) => {
                    setBarcode(event.target.value.toUpperCase());
                    setLookup(null);
                  }}
                  placeholder="Scan barcode and press Enter"
                  autoComplete="off"
                  style={{ ...inputStyle, flex: 1, fontSize: 16, letterSpacing: '0.03em' }}
                />
                <button type="submit" disabled={scanLoading || !barcode.trim()} style={{ padding: '0 18px', border: 0, borderRadius: 8, background: ACCENT, color: '#07110d', font: "800 12px 'Inter'", cursor: 'pointer', opacity: scanLoading ? 0.55 : 1 }}>
                  {scanLoading ? 'Checking…' : 'Find request'}
                </button>
                <button type="button" onClick={() => openBatch(barcode.trim() || undefined)} style={{ padding: '0 16px', borderRadius: 8, border: `1px solid ${ACCENT.replace(')', ' / 0.5)')}`, background: 'transparent', color: ACCENT, font: "800 12px 'Inter'", cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Scan multiple
                </button>
              </form>

              {lookup && (
                <div style={{ marginTop: 14 }}>
                  {lookup.candidates.length > 0 ? (
                    <>
                      <div style={{ font: "700 11px 'Inter'", marginBottom: 7 }}>
                        {lookup.candidates.length === 1 ? 'Matched request' : 'Choose the correct request'}
                      </div>
                      <div style={{ display: 'grid', gap: 7 }}>
                        {lookup.candidates.map((candidate) => (
                          <CandidateCard
                            key={candidate.requestStoneId}
                            candidate={candidate}
                            selected={candidate.requestStoneId === requestStoneId}
                            onSelect={() => {
                              setRequestStoneId(candidate.requestStoneId);
                              setSourceBranch(candidate.sourceBranch);
                            }}
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <div>
                      <div style={{ font: "700 11px 'Inter'", marginBottom: 7 }}>Sending branch</div>
                      <select value={sourceBranch} onChange={(event) => setSourceBranch(event.target.value)} style={{ ...inputStyle, minWidth: 180 }}>
                        <option value="">Select branch</option>
                        {BRANCHES.filter((item) => item !== branch).map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                  )}
                  {lookup.previousReceipts.length > 0 && (
                    <div style={{ marginTop: 10, color: AMBER, font: "600 11px 'Inter'" }}>
                      Previously scanned here: {lookup.previousReceipts.map((row) => componentSummary(row.stoneReceived, row.certReceived)).join('; ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ width: 1, alignSelf: 'stretch', background: t.border }} />

            <div style={{ flex: '1 1 360px', opacity: lookup ? 1 : 0.5 }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <Choice label="STONE RECEIVED?" value={stoneReceived} onChange={setStoneReceived} />
                <Choice label="CERT RECEIVED?" value={certReceived} onChange={setCertReceived} />
              </div>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional note"
                disabled={!lookup}
                maxLength={500}
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 14 }}
              />
              <button
                type="button"
                disabled={!canSave || saving}
                onClick={() => createReceipt()}
                style={{ width: '100%', marginTop: 12, padding: '11px 16px', border: 0, borderRadius: 8, background: ACCENT, color: '#07110d', font: "800 12.5px 'Inter'", cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave && !saving ? 1 : 0.42 }}
              >
                {saving ? 'Saving…' : selectedCandidate ? `Save · Give to ${selectedCandidate.rep.name}` : 'Save receipt'}
              </button>
            </div>
          </div>
        </div>

        <div style={card}>
          <div style={{ padding: '15px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setDate(shiftIsoDate(date, -1))} style={{ ...inputStyle, cursor: 'pointer', padding: '8px 11px' }}>←</button>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ ...inputStyle, padding: '8px 10px' }} />
            <button onClick={() => setDate(shiftIsoDate(date, 1))} disabled={date >= today} style={{ ...inputStyle, cursor: date >= today ? 'not-allowed' : 'pointer', padding: '8px 11px', opacity: date >= today ? 0.4 : 1 }}>→</button>
            {date !== today && <button onClick={() => setDate(today)} style={{ ...inputStyle, cursor: 'pointer', padding: '8px 11px' }}>Today</button>}
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search barcode, rep, request #" style={{ ...inputStyle, marginLeft: 5, minWidth: 225 }} />
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} style={{ ...inputStyle, padding: '8px 10px' }}>
              <option value="">All sending branches</option>
              {BRANCHES.filter((item) => item !== branch).map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReceiptStatus | '')} style={{ ...inputStyle, padding: '8px 10px' }}>
              <option value="">All statuses</option>
              {STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <button onClick={exportDay} style={{ ...inputStyle, cursor: 'pointer', padding: '8px 12px' }}>Export Excel</button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
              <thead>
                <tr style={{ color: t.textFaint, font: "700 10px 'Inter'", textAlign: 'left' }}>
                  {['Time', 'Barcode', 'Stone', 'Cert', 'From', 'Request', 'Give to', 'Status', 'Action'].map((label) => (
                    <th key={label} style={{ padding: '11px 13px', borderBottom: `1px solid ${t.border}`, letterSpacing: '0.03em' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!historyLoading && history.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: t.textFaint, font: "500 12px 'Inter'" }}>No shipments were scanned for this day.</td></tr>
                )}
                {historyLoading && (
                  <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: t.textFaint, font: "500 12px 'Inter'" }}>Loading received shipments…</td></tr>
                )}
                {!historyLoading && history.map((row) => (
                  <tr key={row.id} style={{ font: "600 11.5px 'Inter'", borderBottom: `1px solid ${t.rowBorder}` }}>
                    <td style={{ padding: '13px' }}>{new Date(row.receivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                    <td style={{ padding: '13px', fontWeight: 800 }}><Copyable value={row.barcode} /></td>
                    <td style={{ padding: '13px', color: row.stoneReceived ? GREEN : t.textFaint }}>{row.stoneReceived ? 'Yes' : 'No'}</td>
                    <td style={{ padding: '13px', color: row.certReceived ? GREEN : t.textFaint }}>{row.certReceived ? 'Yes' : 'No'}</td>
                    <td style={{ padding: '13px' }}>{row.sourceBranch}</td>
                    <td style={{ padding: '13px' }}>{row.requestId ? `#${row.requestId}` : '—'}</td>
                    <td style={{ padding: '13px' }}>{row.rep?.name || 'Needs review'}</td>
                    <td style={{ padding: '13px' }}><StatusPill status={row.status} /></td>
                    <td style={{ padding: '9px 13px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {row.canHandoff && <button onClick={() => handoff(row)} style={{ ...inputStyle, cursor: 'pointer', padding: '6px 9px', color: GREEN }}>Hand to rep</button>}
                        {row.matchState === 'unmatched' && <button onClick={() => matchReceipt(row)} style={{ ...inputStyle, cursor: 'pointer', padding: '6px 9px', color: ACCENT }}>Match</button>}
                        <button onClick={() => beginCorrection(row)} style={{ ...inputStyle, cursor: 'pointer', padding: '6px 9px' }}>Correct</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {batchOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ ...card, width: 760, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ font: "800 15px 'Inter'" }}>Scan shipment</div>
              <span style={{ padding: '4px 9px', borderRadius: 20, background: 'oklch(78% 0.13 240 / 0.14)', color: ACCENT, font: "700 10.5px 'Inter'" }}>Receiving at {branch}</span>
              <div style={{ flex: 1 }} />
              <div style={{ font: "600 11px 'Inter'", color: t.textFaint }}>{batchRows.length} scanned</div>
            </div>

            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${t.border}` }}>
              <form onSubmit={(event) => { event.preventDefault(); void addBatchScan(batchScan); }} style={{ display: 'flex', gap: 8 }}>
                <input
                  ref={batchScanRef}
                  value={batchScan}
                  onChange={(event) => setBatchScan(event.target.value.toUpperCase())}
                  placeholder="Scan each barcode and press Enter"
                  autoComplete="off"
                  style={{ ...inputStyle, flex: 1, fontSize: 16, letterSpacing: '0.03em' }}
                />
                <button type="submit" disabled={batchScanning || !batchScan.trim()} style={{ padding: '0 18px', border: 0, borderRadius: 8, background: ACCENT, color: '#07110d', font: "800 12px 'Inter'", cursor: 'pointer', opacity: batchScanning || !batchScan.trim() ? 0.55 : 1 }}>
                  {batchScanning ? 'Adding…' : 'Add'}
                </button>
              </form>
              <div style={{ font: "500 11px 'Inter'", color: t.textFaint, marginTop: 8 }}>
                Each barcode is matched to its own request. Mark exactly what physically arrived, then save the whole batch.
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 20px' }}>
              {batchRows.length === 0 && (
                <div style={{ padding: 28, textAlign: 'center', color: t.textFaint, font: "500 12px 'Inter'" }}>No barcodes scanned yet.</div>
              )}
              {batchRows.map((row) => (
                <div key={row.key} style={{ ...card, padding: 12, marginBottom: 10, opacity: row.saved ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: row.saved ? 0 : 10 }}>
                    <Copyable value={row.barcode} style={{ font: "800 13px 'Inter'", flex: 1 }} />
                    {row.saved && <span style={{ color: GREEN, font: "700 11px 'Inter'" }}>Saved ✓</span>}
                    {row.previousCount > 0 && !row.saved && <span style={{ color: AMBER, font: "600 10.5px 'Inter'" }}>Scanned before</span>}
                    {!row.saved && <button type="button" onClick={() => removeRow(row.key)} style={{ ...inputStyle, cursor: 'pointer', padding: '4px 9px' }}>Remove</button>}
                  </div>
                  {!row.saved && (
                    <>
                      {row.loading ? (
                        <div style={{ color: t.textFaint, font: "500 12px 'Inter'" }}>Looking up request…</div>
                      ) : (
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <div style={{ flex: '1 1 300px' }}>
                            {row.candidates.length > 0 ? (
                              <div style={{ display: 'grid', gap: 6 }}>
                                <div style={{ font: "700 10.5px 'Inter'", color: t.textFaint }}>{row.candidates.length === 1 ? 'Matched request' : 'Choose the correct request'}</div>
                                {row.candidates.map((candidate) => (
                                  <CandidateCard
                                    key={candidate.requestStoneId}
                                    candidate={candidate}
                                    selected={candidate.requestStoneId === row.requestStoneId}
                                    onSelect={() => updateRow(row.key, { requestStoneId: candidate.requestStoneId, sourceBranch: candidate.sourceBranch })}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div>
                                <div style={{ font: "700 10.5px 'Inter'", color: t.textFaint, marginBottom: 6 }}>No open request matched — pick the sending branch</div>
                                {row.elsewhereNote && (
                                  <div style={{ font: "600 10.5px 'Inter'", color: AMBER, marginBottom: 6 }}>{row.elsewhereNote}</div>
                                )}
                                <select value={row.sourceBranch} onChange={(event) => updateRow(row.key, { sourceBranch: event.target.value })} style={{ ...inputStyle, minWidth: 170 }}>
                                  <option value="">Select branch</option>
                                  {BRANCHES.filter((item) => item !== branch).map((item) => <option key={item}>{item}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 18 }}>
                            <Choice label="STONE?" value={row.stoneReceived} onChange={(value) => updateRow(row.key, { stoneReceived: value })} />
                            <Choice label="CERT?" value={row.certReceived} onChange={(value) => updateRow(row.key, { certReceived: value })} />
                          </div>
                        </div>
                      )}
                      {row.error && <div style={{ marginTop: 8, color: RED, font: "600 11px 'Inter'" }}>{row.error}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: '14px 20px', borderTop: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, font: "600 11.5px 'Inter'", color: t.textMuted, cursor: 'pointer' }}>
                <input type="checkbox" checked={allowDuplicates} onChange={(event) => setAllowDuplicates(event.target.checked)} />
                Allow duplicate packages
              </label>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={closeBatch} style={{ ...inputStyle, cursor: 'pointer' }}>Close</button>
              <button
                type="button"
                disabled={batchSaving || batchRows.filter((row) => !row.saved && !row.loading && receiptFormReady(batchRowFormState(row))).length === 0}
                onClick={saveBatch}
                style={{ padding: '11px 18px', border: 0, borderRadius: 8, background: ACCENT, color: '#07110d', font: "800 12.5px 'Inter'", cursor: 'pointer', opacity: batchSaving ? 0.55 : 1 }}
              >
                {batchSaving ? 'Saving…' : `Save ${batchRows.filter((row) => !row.saved && !row.loading && receiptFormReady(batchRowFormState(row))).length} received`}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ ...card, width: 430, maxWidth: '100%', padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ font: "800 15px 'Inter'" }}>Correct <Copyable value={editing.barcode} /></div>
            <div style={{ color: t.textFaint, font: "500 11px 'Inter'", marginTop: 4 }}>
              The original scan remains in the audit history.
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 18 }}>
              <Choice label="STONE RECEIVED?" value={editStone} onChange={setEditStone} />
              <Choice label="CERT RECEIVED?" value={editCert} onChange={setEditCert} />
            </div>
            {editing.matchState === 'unmatched' && (
              <select value={editSource} onChange={(event) => setEditSource(event.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 14 }}>
                {BRANCHES.filter((item) => item !== branch).map((item) => <option key={item}>{item}</option>)}
              </select>
            )}
            <input value={editNote} onChange={(event) => setEditNote(event.target.value)} placeholder="Correction note" maxLength={500} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 14 }} />
            {!editStone && !editCert && <div style={{ marginTop: 9, color: RED, font: "600 11px 'Inter'" }}>At least Stone or Cert must be Yes.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setEditing(null)} style={{ ...inputStyle, cursor: 'pointer' }}>Cancel</button>
              <button disabled={!editStone && !editCert} onClick={() => saveCorrection()} style={{ padding: '10px 15px', border: 0, borderRadius: 8, background: ACCENT, color: '#07110d', font: "800 12px 'Inter'", cursor: 'pointer', opacity: !editStone && !editCert ? 0.4 : 1 }}>Save correction</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
