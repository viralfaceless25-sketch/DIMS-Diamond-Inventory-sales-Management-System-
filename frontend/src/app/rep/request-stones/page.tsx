'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, LooseStone, JewelryPiece, ExtractedStone, StockRecheck } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranchSocket } from '@/lib/socket';
import { useTheme, useCartBadge, useStockFilters } from '../repContext';
import { ACCENT, AMBER, RED } from '@/lib/theme';
import { fmtCarat, fmtMeasurements, sortStonesClient } from '@/lib/utils';
import {
  availabilityText,
  canAddToHomeBranch,
  canRequestAvailability,
  defaultFulfillmentChoice,
  deliveryRouteForChoice,
  FulfillmentChoice,
  fulfillmentChoiceLabel,
  fulfillmentChoicesFor,
  hasDeliveryWorkflow,
} from '@/lib/requestWorkflow';
import { Check } from '@/components/ui';

interface CartItem {
  barcode: string;
  shape: string | null;
  carat: number | string | null;
  color: string | null;
  clarity: string | null;
  itemType: string;
  branch: string;
  source?: 'manual' | 'invoice_upload';
  // Whether the snapshot has a certificate number for this piece. A stone
  // with none has nothing for inventory to check off as "Cert found" — the
  // request scope is restricted to Stone only in that case.
  hasCert?: boolean;
}

type RequestScope = 'stone_and_cert' | 'stone_only' | 'cert_only';

const STOCK_TABLE_COLUMNS = '40px minmax(0,1.1fr) 48px 90px 70px minmax(165px,1.1fr) 50px 60px minmax(0,1.1fr)';

function extractBarcodes(value: string) {
  const matches = value.match(/\b\d{5,8}-\d{2,4}[A-Z]?\b/gi) || [];
  return [...new Set(matches.map((barcode) => barcode.toUpperCase()))].slice(0, 50);
}

export default function RequestStonesPage() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const { setCount } = useCartBadge();
  const { colors: colorFilter, clarities: clarityFilter, shapes: shapeFilter } = useStockFilters();
  const branch = user?.branch || 'NY';

  // The sidebar mini diamond search links here with ?q=<barcode>, which
  // pre-fills the main search box so the picked stone is the first result.
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('q') || '';

  const [stock, setStock] = useState<LooseStone[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [confirmMsg, setConfirmMsg] = useState('');
  const [confirmError, setConfirmError] = useState(false);
  const [barcodeEntry, setBarcodeEntry] = useState('');
  const [barcodeMsg, setBarcodeMsg] = useState('');
  const [barcodeError, setBarcodeError] = useState(false);
  const [lookupRecheckItems, setLookupRecheckItems] = useState<Array<{
    barcode: string;
    itemType: 'loose' | 'jewelry';
  }>>([]);
  const [requestScope, setRequestScope] = useState<RequestScope>('stone_and_cert');
  const [fulfillmentChoice, setFulfillmentChoice] = useState<FulfillmentChoice | null>(null);
  const [deliveryBranch, setDeliveryBranch] = useState<'NY' | 'LA' | 'CH'>('NY');
  const [rechecks, setRechecks] = useState<StockRecheck[]>([]);
  const [recheckBusy, setRecheckBusy] = useState<string | null>(null);
  const [dropoffCompany, setDropoffCompany] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');

  // Invoice upload state
  const [extracting, setExtracting] = useState(false);
  const [extractName, setExtractName] = useState('');
  const [extracted, setExtracted] = useState<ExtractedStone[] | null>(null);
  const [extractWarning, setExtractWarning] = useState('');
  const [unavailable, setUnavailable] = useState<ExtractedStone[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const homeBranch = cart[0]?.branch || null;
  // A stone with no certificate on file has nothing for inventory to check
  // off as "Cert found" — once the cart holds one, cert-inclusive scopes are
  // hidden and the request is restricted to Stone only.
  const cartHasCertlessItem = cart.some((item) => item.hasCert === false);
  const requestForOptions = (
    [
      ['stone_and_cert', 'Stone + cert'],
      ['stone_only', 'Stone only'],
      ['cert_only', 'Cert only'],
    ] as const
  ).filter(([value]) => !cartHasCertlessItem || value === 'stone_only');
  const isCrossBranch = Boolean(homeBranch && homeBranch !== branch);
  const deliveryRoute = deliveryRouteForChoice(fulfillmentChoice);
  const deliveryWorkflow = hasDeliveryWorkflow(isCrossBranch, deliveryRoute);
  const extractedBranches = [...new Set(
    (extracted || [])
      .filter((stone) => isExtractedRequestable(stone))
      .map((stone) => stone.stockBranch || stone.branch)
      .filter((value): value is string => Boolean(value))
  )].sort();
  const unavailableNow = unavailable.filter(
    (stone) => !isExtractedRequestable(stone)
  );

  // Drag-and-drop state. dragDepth is a counter (incremented on dragenter,
  // decremented on dragleave) so the overlay doesn't flicker when the cursor
  // passes over child elements.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, recheckRows] = await Promise.all([
        api.looseStock({
          // Sales reps browse every branch. The selected supply route is enforced
          // when a row is added, so one request cannot mix supplying branches.
          branch: 'ALL',
          page,
          pageSize: PAGE_SIZE,
          search: search || undefined,
          colors: colorFilter,
          clarities: clarityFilter,
          shapes: shapeFilter,
          requestableOnly: false,
        }),
        api.myStockRechecks(),
      ]);
      setStock(res.rows);
      setTotal(res.total);
      setRechecks(recheckRows);
    } catch (error) {
      setConfirmMsg(error instanceof Error ? error.message : 'Could not load stock.');
      setConfirmError(true);
    } finally {
      setLoading(false);
    }
  }, [page, search, colorFilter, clarityFilter, shapeFilter]);

  useEffect(() => {
    load();
  }, [load]);
  // Re-applies ?q= when the mini search is used again while already on this
  // page (client-side nav to the same route doesn't remount, so the initial
  // useState value above wouldn't otherwise pick up a second search).
  useEffect(() => {
    const q = searchParams.get('q') || '';
    if (q) setSearch(q);
  }, [searchParams]);
  useEffect(() => {
    setCount(cart.length);
  }, [cart, setCount]);
  // Reset to first page whenever filters/search change.
  useEffect(() => {
    setPage(1);
  }, [search, colorFilter, clarityFilter, shapeFilter, branch]);
  useBranchSocket(branch, (ev) => {
    if (ev === 'stock:updated' || ev.startsWith('request:') || ev.startsWith('stock:recheck_')) load();
  });
  useEffect(() => {
    const nextChoice = defaultFulfillmentChoice(homeBranch, branch);
    setFulfillmentChoice(nextChoice);
    const branchChoices = (['NY', 'LA', 'CH'] as const)
      .filter((candidate) => candidate !== homeBranch);
    setDeliveryBranch(
      branchChoices.find((candidate) => candidate !== branch)
        || branchChoices[0]
        || 'NY'
    );
    setDropoffCompany('');
    setDropoffAddress('');
  }, [homeBranch, branch]);
  // If the cart picks up a certless stone while Stone + cert / Cert only was
  // selected, snap the scope back to Stone only rather than let the rep
  // submit a request for a certificate that doesn't exist.
  useEffect(() => {
    if (cartHasCertlessItem && requestScope !== 'stone_only') {
      setRequestScope('stone_only');
    }
  }, [cartHasCertlessItem, requestScope]);

  const inCart = (barcode: string) => cart.some((c) => c.barcode === barcode);

  function latestRecheck(barcode: string, itemType: 'loose' | 'jewelry') {
    return rechecks.find(
      (recheck) => recheck.barcode === barcode
        && recheck.itemType === itemType
    );
  }

  function hasUsableLiveVerification(
    item: Pick<LooseStone, 'barcode' | 'last_seen_at'>,
    itemType: 'loose' | 'jewelry'
  ) {
    const recheck = latestRecheck(item.barcode, itemType);
    if (recheck?.state !== 'verified_available' || !recheck.verifiedAt) return false;
    const verifiedAt = new Date(recheck.verifiedAt).getTime();
    const snapshotAt = item.last_seen_at
      ? new Date(item.last_seen_at).getTime()
      : null;
    return Number.isFinite(verifiedAt)
      && (!snapshotAt || verifiedAt > snapshotAt);
  }

  function isExtractedRequestable(stone: ExtractedStone) {
    return stone.available || hasUsableLiveVerification(
      { barcode: stone.barcode, last_seen_at: stone.last_seen_at },
      stone.item_type
    );
  }

  async function requestLiveRecheck(
    event: React.MouseEvent,
    item: Pick<LooseStone, 'barcode'>,
    itemType: 'loose' | 'jewelry'
  ) {
    event.stopPropagation();
    setRecheckBusy(item.barcode);
    setConfirmMsg('');
    setConfirmError(false);
    try {
      const result = await api.requestStockRecheck(item.barcode, itemType);
      setRechecks((current) => [
        result,
        ...current.filter((row) => row.id !== result.id),
      ]);
      setConfirmMsg(
        result.state === 'verified_available'
          ? `${item.barcode} was already verified available. You can add it now.`
          : `${item.barcode} was sent to ${result.homeBranch} inventory for a live ERP recheck.`
      );
    } catch (error) {
      setConfirmMsg(error instanceof Error ? error.message : 'Could not request a live ERP recheck.');
      setConfirmError(true);
    } finally {
      setRecheckBusy(null);
    }
  }

  function availabilityColor(av: LooseStone['availability']) {
    if (av.status === 'in_stock') return ACCENT;
    if (av.status === 'conflict' || av.status === 'on_hold') return RED;
    return AMBER;
  }

  function toggleCart(s: LooseStone) {
    setConfirmMsg('');
    setConfirmError(false);
    if (!canRequestAvailability(s.availability)
        && !hasUsableLiveVerification(s, 'loose')) {
      setConfirmMsg(`${s.barcode} cannot be requested: ${availabilityText(s.availability)}.`);
      setConfirmError(true);
      return;
    }
    const currentHomeBranch = cart[0]?.branch || null;
    if (!canAddToHomeBranch(currentHomeBranch, s.branch)) {
      setConfirmMsg(`This request is already going to ${currentHomeBranch} inventory. Submit it first, then request ${s.barcode} from ${s.branch}.`);
      setConfirmError(true);
      return;
    }
    setCart((prev) =>
      prev.some((c) => c.barcode === s.barcode)
        ? prev.filter((c) => c.barcode !== s.barcode)
        : [...prev, { barcode: s.barcode, shape: s.shape, carat: s.carat, color: s.color, clarity: s.clarity, itemType: 'loose', branch: s.branch, hasCert: Boolean(s.certificate_no) }]
    );
  }

  // Server already filtered + sorted; render the page as-is.
  const filtered = stock;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  async function submit(items: CartItem[], clearCartAfter: boolean, source: 'manual' | 'invoice_upload' = 'manual') {
    if (items.length === 0) return;
    setConfirmError(false);
    if (!fulfillmentChoice) {
      setConfirmMsg('Choose how this request should be fulfilled.');
      setConfirmError(true);
      return;
    }
    if (deliveryRoute === 'customer_dropoff' && !dropoffAddress.trim()) {
      setConfirmMsg('Drop-off requests need a complete delivery address.');
      setConfirmError(true);
      return;
    }
    try {
      await api.submitRequest(
        items.map((c) => ({ barcode: c.barcode, itemType: c.itemType })),
        source,
        {
          requestScope,
          dropoffCompany: dropoffCompany.trim(),
          dropoffAddress: dropoffAddress.trim(),
          fulfillmentChoice,
          ...(fulfillmentChoice === 'bt_to_branch' ? { deliveryBranch } : {}),
        }
      );
      setConfirmMsg(`Request for ${items.length} stone${items.length === 1 ? '' : 's'} sent to inventory.`);
      if (clearCartAfter) setCart([]);
      await load();
    } catch (err) {
      setConfirmMsg(err instanceof Error ? err.message : 'Could not send this request.');
      setConfirmError(true);
    }
  }

  async function addBarcodeToCart() {
    const barcodes = extractBarcodes(barcodeEntry);
    setBarcodeMsg('');
    setBarcodeError(false);
    setLookupRecheckItems([]);
    if (!barcodes.length) {
      setBarcodeMsg('No stock barcode found. Paste the stock details or enter a barcode such as 1509620-132.');
      setBarcodeError(true);
      return;
    }
    try {
      const results = await Promise.all(barcodes.map(async (barcode) => {
        const looseRes = await api.looseStock({ branch: 'ALL', barcode, page: 1, pageSize: 10 });
        const exactLoose = looseRes.rows.find((stone) => stone.barcode.toUpperCase() === barcode);
        let exactJewelry: JewelryPiece | undefined;
        if (!exactLoose) {
          const jewelryRes = await api.jewelryStock({ branch: 'ALL', barcode, page: 1, pageSize: 10 });
          exactJewelry = jewelryRes.rows.find((piece) => piece.barcode.toUpperCase() === barcode);
        }
        const exact = exactLoose || exactJewelry;
        if (!exact) return { barcode, error: 'not found' };
        const itemType = exactLoose ? 'loose' as const : 'jewelry' as const;
        if (!canRequestAvailability(exact.availability)
            && !hasUsableLiveVerification(exact, itemType)) {
          return {
            barcode,
            error: availabilityText(exact.availability),
            recheckItem: { barcode: exact.barcode, itemType },
          };
        }
        const item: CartItem = exactLoose
          ? { barcode: exactLoose.barcode, shape: exactLoose.shape, carat: exactLoose.carat, color: exactLoose.color, clarity: exactLoose.clarity, itemType: 'loose', branch: exactLoose.branch, hasCert: Boolean(exactLoose.certificate_no) }
          : { barcode: exactJewelry!.barcode, shape: exactJewelry!.item || exactJewelry!.category || 'Jewelry', carat: exactJewelry!.diamond_cts ?? null, color: null, clarity: null, itemType: 'jewelry', branch: exactJewelry!.branch, hasCert: Boolean(exactJewelry!.cert_no) };
        return { barcode, item };
      }));

      const currentBarcodes = new Set(cart.map((item) => item.barcode));
      const lookupAdditions = results.flatMap((result) => result.item && !currentBarcodes.has(result.item.barcode) ? [result.item] : []);
      const currentHomeBranch = cart[0]?.branch || lookupAdditions[0]?.branch || null;
      const additions = lookupAdditions.filter((item) => canAddToHomeBranch(currentHomeBranch, item.branch));
      const unavailable = results.filter((result) => result.error).length + (lookupAdditions.length - additions.length);
      setLookupRecheckItems(
        results.flatMap((result) => result.recheckItem ? [result.recheckItem] : [])
      );
      setCart((prev) => {
        const existing = new Set(prev.map((item) => item.barcode));
        return [...prev, ...additions.filter((item) => !existing.has(item.barcode))];
      });
      setBarcodeEntry('');
      const messages = [
        additions.length ? `${additions.length} barcode${additions.length === 1 ? '' : 's'} added for review.` : '',
        unavailable ? `${unavailable} unavailable, in another home branch, or not found.` : '',
      ].filter(Boolean);
      setBarcodeMsg(messages.join(' '));
      setBarcodeError(additions.length === 0);
    } catch (err) {
      setBarcodeMsg(err instanceof Error ? err.message : 'Could not look up that barcode.');
      setBarcodeError(true);
    }
  }

  // Core flow: extract stones from a PDF, validate each against our stock for
  // this branch, then pause for the rep to review before anything is sent.
  async function processInvoiceForReview(file: File) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setExtractWarning('That file isn’t a PDF. Drop an invoice or memo PDF.');
      setExtracted(null);
      setUnavailable([]);
      return;
    }
    setExtracting(true);
    setExtractName(file.name);
    setExtractWarning('');
    setExtracted(null);
    setUnavailable([]);
    try {
      const res = await api.extractInvoice(file);
      if (!res.stones || res.stones.length === 0) {
        setExtractWarning(res.warning || 'No stones could be read from that PDF.');
        return;
      }

      const sorted = sortStonesClient(res.stones) as ExtractedStone[];
      const available = sorted.filter((s) => s.available);
      const notAvailable = sorted.filter((s) => !s.available);
      setExtracted(sorted);
      setUnavailable(notAvailable);

      if (available.length === 0) {
        // Nothing in stock — don't send an empty request.
        setExtractWarning(
          `None of the ${res.stones.length} item${res.stones.length === 1 ? '' : 's'} on this PDF ${res.stones.length === 1 ? 'is' : 'are'} available in the latest NY, LA, or CH stock snapshot.`
        );
        return;
      }

      if (res.warning) setExtractWarning(res.warning);
    } catch (err) {
      setExtractWarning(err instanceof Error ? err.message : 'Could not read that invoice');
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onInvoiceInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processInvoiceForReview(file);
  }

  function extractedReason(s: ExtractedStone) {
    if (isExtractedRequestable(s)) return `${s.available ? 'Available' : 'Live ERP: Available'} · ${s.stockBranch || s.branch || 'home branch unknown'}`;
    if (s.availabilityLabel) return s.availabilityLabel;
    if (s.reason === 'on_memo') return 'On Memo';
    if (s.reason === 'on_hold') return 'On Hold';
    if (s.reason === 'not_in_snapshot') return 'Not in latest ERP snapshot';
    return 'Not in preserved stock';
  }

  function extractedColor(s: ExtractedStone) {
    if (isExtractedRequestable(s)) return ACCENT;
    if (s.reason === 'on_hold') return RED;
    return AMBER;
  }

  function addReviewedToCart(targetBranch: string) {
    if (!extracted) return;
    const available = extracted.filter(
      (stone) => isExtractedRequestable(stone)
        && (stone.stockBranch || stone.branch) === targetBranch
    );
    if (cart.length && cart[0].branch !== targetBranch) {
      setConfirmMsg(`Submit the current ${cart[0].branch} cart before loading the ${targetBranch} group from this PDF.`);
      setConfirmError(true);
      return;
    }
    setCart((prev) => {
      const existing = new Set(prev.map((c) => c.barcode));
      const additions = available
        .filter((s) => !existing.has(s.barcode))
        .map((s) => ({ barcode: s.barcode, shape: s.shape, carat: s.carat, color: s.color, clarity: s.clarity, itemType: s.item_type, branch: s.stockBranch || branch, source: 'invoice_upload' as const, hasCert: Boolean(s.certificate_no) }))
        .filter((item) => canAddToHomeBranch(prev[0]?.branch || null, item.branch));
      return [...prev, ...additions];
    });
    setConfirmMsg(`${available.length} ${targetBranch} item${available.length === 1 ? '' : 's'} added. Choose the ${targetBranch === branch ? 'local' : 'BT'} fulfillment option, then submit.`);
    setConfirmError(false);
  }

  // Full-page drag-and-drop handlers.
  function onDragEnter(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  }
  function onDragLeave(e: React.DragEvent) {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processInvoiceForReview(file);
  }

  return (
    <div
      style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, position: 'relative' }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Full-page drag overlay */}
      {dragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'oklch(20% 0.03 150 / 0.72)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ border: `2px dashed ${ACCENT}`, borderRadius: 16, padding: '48px 64px', textAlign: 'center', background: 'oklch(18% 0.02 150 / 0.6)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.6" style={{ marginBottom: 12 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
            <div style={{ font: "700 16px 'Inter'", color: '#fff' }}>Drop PDF to extract for review</div>
            <div style={{ font: "400 12px 'Inter'", color: 'oklch(75% 0.02 150)', marginTop: 6 }}>Stones are sorted here first; inventory only receives them after you send.</div>
          </div>
        </div>
      )}

      {/* Main column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Header row 1: title + invoice + search */}
        <div style={{ padding: '20px 26px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ font: "700 18px 'Inter'", color: t.text }}>Request stones · {branch}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input ref={fileRef} type="file" accept="application/pdf" onChange={onInvoiceInput} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ padding: '9px 15px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.bgCard, color: t.text, font: "600 12px 'Inter'", cursor: 'pointer' }}>
                Upload invoice
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: '8px 12px', width: 200 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock#" style={{ background: 'none', border: 'none', outline: 'none', color: t.text, font: "400 12.5px 'Inter'", width: '100%' }} />
              </div>
            </div>
          </div>

          {/* Hint that the page is a drop target */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 14, background: t.chipBg, border: `1px dashed ${t.borderLight}`, borderRadius: 9, font: "500 11.5px 'Inter'", color: t.textFaint }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.textFaint} strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
            Drag an invoice or memo PDF anywhere on this page — it&apos;ll be read, sorted, and held here for review.
          </div>

          {/* Extraction spinner */}
          {extracting && (
            <div style={{ padding: '12px 14px', background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, marginBottom: 14, font: "500 12.5px 'Inter'", color: t.textMuted }}>
              Reading {extractName} for review…
            </div>
          )}

          {/* Warning (bad file / scanned PDF / nothing found / none available) */}
          {extractWarning && !extracting && (
            <div style={{ padding: '12px 14px', background: 'oklch(75% 0.14 80 / 0.1)', border: '1px solid oklch(75% 0.14 80 / 0.3)', borderRadius: 10, marginBottom: 14, font: "500 12px 'Inter'", color: AMBER }}>
              {extractWarning}
            </div>
          )}

          {/* Unavailable diamonds — detected on the invoice but NOT in stock */}
          {extracted && extracted.length > 0 && !extracting && (
            <div style={{ padding: 14, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ font: "600 12.5px 'Inter'", color: t.text }}>Review {extracted.length} extracted stone{extracted.length === 1 ? '' : 's'} from {extractName}</div>
                  <div style={{ font: "400 11px 'Inter'", color: t.textFaint, marginTop: 2 }}>
                    {extracted.filter((stone) => isExtractedRequestable(stone)).length} available across {extractedBranches.length} home branch{extractedBranches.length === 1 ? '' : 'es'}
                  </div>
                </div>
                <div onClick={() => setExtracted(null)} style={{ cursor: 'pointer', color: t.textFaint, font: "600 15px 'Inter'", padding: '0 4px' }}>×</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {extracted.map((s) => (
                  <div key={s.barcode} style={{ display: 'grid', gridTemplateColumns: '110px 42px 70px 55px 50px 60px minmax(0,1fr)', gap: 10, alignItems: 'center', font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>
                    <span style={{ color: t.text }}>{s.barcode}</span>
                    <span style={{ font: "800 10px 'Inter'", color: t.textMuted }}>{s.stockBranch || s.branch || '—'}</span>
                    <span>{s.shape || '—'}</span>
                    <span>{fmtCarat(s.carat)}</span>
                    <span>{s.color || '—'}</span>
                    <span>{s.clarity || '—'}</span>
                    <span style={{ font: "600 10.5px 'Inter'", color: extractedColor(s), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{extractedReason(s)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {extractedBranches.map((invoiceBranch) => {
                  const count = extracted.filter((stone) => isExtractedRequestable(stone) && (stone.stockBranch || stone.branch) === invoiceBranch).length;
                  return (
                    <button key={invoiceBranch} onClick={() => addReviewedToCart(invoiceBranch)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: ACCENT, color: '#0a0e0d', font: "700 12px 'Inter'", cursor: 'pointer' }}>
                      Load {count} from {invoiceBranch} into cart
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {unavailableNow.length > 0 && !extracting && (
            <div style={{ padding: 14, background: 'oklch(70% 0.17 30 / 0.1)', border: '1px solid oklch(70% 0.17 30 / 0.34)', borderRadius: 10, marginBottom: 14 }}>
              <div style={{ font: "600 12.5px 'Inter'", color: RED, marginBottom: 8 }}>
                ⚠ {unavailableNow.length} item{unavailableNow.length === 1 ? '' : 's'} not available — not sent
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {unavailableNow.map((s) => (
                  <div key={s.barcode} style={{ display: 'flex', gap: 10, alignItems: 'center', font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>
                    <span style={{ color: t.text, minWidth: 110 }}>{s.barcode}</span>
                    <span style={{ font: "500 10.5px 'Inter'", color: RED }}>
                      {extractedReason(s)}
                    </span>
                    {['on_hold', 'on_memo', 'in_transit', 'not_in_snapshot'].includes(s.reason || '') && (
                      latestRecheck(s.barcode, s.item_type)?.state === 'pending'
                        ? <span style={{ font: "700 9.5px 'Inter'", color: AMBER }}>Live recheck pending at {s.stockBranch}</span>
                        : (
                          <button onClick={(event) => requestLiveRecheck(event, s, s.item_type)} style={{ padding: '4px 7px', borderRadius: 5, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: ACCENT, font: "700 9.5px 'Inter'", cursor: 'pointer' }}>
                            Ask {s.stockBranch} to recheck ERP
                          </button>
                        )
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Cart review stays above the table, so selected stones never get lost while scrolling stock. */}
        <div style={{ margin: '0 26px 10px', padding: '10px 12px', background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ flex: 'none' }}><div style={{ font: "700 12.5px 'Inter'", color: t.text }}>Request cart</div><div style={{ font: "500 10.5px 'Inter'", color: t.textFaint }}>{cart.length} selected</div></div>
          <div style={{ display: 'flex', gap: 5, flex: 'none', alignItems: 'center' }}><textarea value={barcodeEntry} onChange={(e) => setBarcodeEntry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addBarcodeToCart(); } }} placeholder="Paste stock details or barcode" aria-label="Paste stock details or barcode" style={{ width: 205, minHeight: 34, maxHeight: 64, resize: 'vertical', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 6, padding: '7px 8px', color: t.text, font: "500 11px Arial, sans-serif", outline: 'none' }} /><button onClick={addBarcodeToCart} style={{ padding: '7px 9px', borderRadius: 6, border: 'none', background: ACCENT, color: '#0a0e0d', font: "700 11px 'Inter'", cursor: 'pointer' }}>Extract</button></div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', minWidth: 0, flex: 1, padding: '1px 0' }}>{cart.length === 0 ? <span style={{ font: "500 11px 'Inter'", color: t.textFaint }}>Select stones from the table.</span> : sortStonesClient(cart).map((c) => <div key={c.barcode} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', whiteSpace: 'nowrap', background: t.chipBg, border: `1px solid ${t.borderLight}`, borderRadius: 6 }}><span style={{ font: "700 10.5px Arial, sans-serif", color: t.text }}>{c.barcode}</span><button onClick={() => setCart((p) => p.filter((x) => x.barcode !== c.barcode))} aria-label={`Remove ${c.barcode}`} style={{ cursor: 'pointer', color: t.textFaint, font: "700 14px 'Inter'", padding: 0, background: 'transparent', border: 'none' }}>x</button></div>)}</div>
        </div>
        {barcodeMsg && <div style={{ margin: '0 26px 8px', font: "500 10.5px 'Inter'", color: barcodeError ? RED : ACCENT }}>{barcodeMsg}</div>}
        {lookupRecheckItems.length > 0 && (
          <div style={{ margin: '0 26px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {lookupRecheckItems.map((item) => {
              const recheck = latestRecheck(item.barcode, item.itemType);
              const pending = recheck?.state === 'pending';
              return (
                <button
                  key={`${item.itemType}:${item.barcode}`}
                  onClick={(event) => requestLiveRecheck(event, item, item.itemType)}
                  disabled={pending || recheckBusy === item.barcode}
                  style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: pending ? AMBER : t.text, font: "700 10.5px 'Inter'", cursor: pending ? 'default' : 'pointer' }}
                >
                  {pending ? `${item.barcode}: waiting for ${recheck.homeBranch}` : `Ask home branch to recheck ${item.barcode}`}
                </button>
              );
            })}
          </div>
        )}

        {/* The stock table uses the full main pane; filters live below the left navigation. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', paddingBottom: 26 }}>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: '4px 26px 0' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFaint }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', font: "400 13px 'Inter'", color: t.textFaint }}>No stones match your filters.</div>
          ) : (
            <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: STOCK_TABLE_COLUMNS, gap: 8, padding: '10px 16px', font: "600 9.5px 'Inter'", color: t.textFaint }}>
                <div></div><div>STOCK #</div><div>BRANCH</div><div>SHAPE</div><div>CARAT</div><div>MEASUREMENTS / RATIO</div><div>COL</div><div>CLTY</div><div>AVAILABILITY</div>
              </div>
              {filtered.map((s) => {
                const selected = inCart(s.barcode);
                const av = s.availability;
                const avText = availabilityText(av);
                const avColor = availabilityColor(av);
                const recheck = latestRecheck(s.barcode, 'loose');
                const liveAvailable = hasUsableLiveVerification(s, 'loose');
                const canRecheck = ['on_hold', 'on_memo', 'in_transit', 'not_in_snapshot']
                  .includes(av.status);
                return (
                  <div key={s.barcode} onClick={() => toggleCart(s)} style={{ display: 'grid', gridTemplateColumns: STOCK_TABLE_COLUMNS, gap: 8, padding: '10px 16px', alignItems: 'center', borderTop: `1px solid ${t.rowBorder}`, cursor: canRequestAvailability(av) || liveAvailable ? 'pointer' : 'default', background: selected ? 'oklch(78% 0.13 240 / 0.08)' : 'transparent' }}>
                    <Check checked={selected} onClick={() => toggleCart(s)} size={17} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.barcode}</div>
                      {s.certificate_no && <div style={{ font: "400 10px 'JetBrains Mono'", color: t.textFaint }}>{s.certificate_no}</div>}
                    </div>
                    <div style={{ font: "800 10.5px Arial, sans-serif", color: t.textMuted }}>{s.branch}</div>
                    <div style={{ font: "400 11.5px 'Inter'", color: t.textMuted }}>{s.shape || '—'}</div>
                    <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textMuted }}>{fmtCarat(s.carat)}</div>
                    <div style={{ font: "600 11px Arial, sans-serif", color: t.textMuted, whiteSpace: 'nowrap' }}>{fmtMeasurements(s.length_mm, s.width_mm, s.height_mm, s.lw_ratio)}</div>
                    <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text }}>{s.color || '—'}</div>
                    <div style={{ font: "500 11.5px 'JetBrains Mono'", color: t.text }}>{s.clarity || '—'}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: "600 10.5px 'Inter'", color: liveAvailable ? ACCENT : avColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {liveAvailable ? 'Live ERP: Available' : avText}
                      </div>
                      {canRecheck && !liveAvailable && (
                        recheck?.state === 'pending'
                          ? <div style={{ font: "700 9px 'Inter'", color: AMBER, marginTop: 3 }}>Recheck pending at {recheck.homeBranch}</div>
                          : (
                            <button
                              onClick={(event) => requestLiveRecheck(event, s, 'loose')}
                              disabled={recheckBusy === s.barcode}
                              style={{ marginTop: 3, padding: 0, border: 'none', background: 'transparent', color: ACCENT, font: "700 9px 'Inter'", cursor: 'pointer', textAlign: 'left' }}
                            >
                              {recheckBusy === s.barcode ? 'Sending…' : 'Ask home branch to recheck ERP'}
                            </button>
                          )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && total > PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <span style={{ font: "500 11.5px 'Inter'", color: t.textFaint }}>{total.toLocaleString()} stones</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => page > 1 && setPage(page - 1)} disabled={page <= 1} style={{ padding: '6px 11px', borderRadius: 7, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: page <= 1 ? t.textFainter : t.textMuted, font: "600 11px 'Inter'", cursor: page <= 1 ? 'default' : 'pointer' }}>‹ Prev</button>
                <span style={{ font: "500 11.5px 'JetBrains Mono'", color: t.textFaint, padding: '0 6px' }}>{page} / {totalPages}</span>
                <button onClick={() => page < totalPages && setPage(page + 1)} disabled={page >= totalPages} style={{ padding: '6px 11px', borderRadius: 7, border: `1px solid ${t.borderLight}`, background: t.bgCard, color: page >= totalPages ? t.textFainter : t.textMuted, font: "600 11px 'Inter'", cursor: page >= totalPages ? 'default' : 'pointer' }}>Next ›</button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
      <div style={{ width: 248, flex: 'none', minHeight: 0, borderLeft: `1px solid ${t.border}`, background: t.bgSide, display: 'flex', flexDirection: 'column', padding: 20 }}>
        <div style={{ font: "700 14px 'Inter'", color: t.text, marginBottom: 4 }}>Request settings</div>
        <div style={{ font: "400 11.5px 'Inter'", color: t.textFaint, marginBottom: 16 }}>Choose branch, request scope, and delivery type.</div>

        <div style={{ display: 'none' }}>
          <div style={{ font: "600 10.5px 'Inter'", color: t.textFaint, marginBottom: 7 }}>ADD BY BARCODE</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={barcodeEntry}
              onChange={(e) => setBarcodeEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addBarcodeToCart();
              }}
              placeholder="268140-003A"
              style={{ minWidth: 0, flex: 1, background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 7, padding: '7px 8px', color: t.text, font: "500 11px 'JetBrains Mono'", outline: 'none' }}
            />
            <button onClick={addBarcodeToCart} style={{ padding: '7px 9px', borderRadius: 7, border: 'none', background: ACCENT, color: '#0a0e0d', font: "700 11px 'Inter'", cursor: 'pointer' }}>Add</button>
          </div>
          {barcodeMsg && <div style={{ marginTop: 7, font: "500 10.5px 'Inter'", color: barcodeError ? RED : ACCENT }}>{barcodeMsg}</div>}
        </div>

        <div style={{ display: 'none' }}>
          {cart.length === 0 ? (
            <div style={{ font: "400 12px 'Inter'", color: t.textFaint, marginTop: 20, textAlign: 'center' }}>Tap stones to add them here.</div>
          ) : (
            sortStonesClient(cart).map((c) => (
              <div key={c.barcode} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ font: "500 11px 'JetBrains Mono'", color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.barcode}</div>
                  <div style={{ font: "400 10px 'Inter'", color: t.textFaint }}>{c.itemType === 'jewelry' ? `${c.shape || 'Jewelry'} - ${fmtCarat(c.carat)} d.cts` : `${c.color || '-'} - ${c.clarity || '-'} - ${fmtCarat(c.carat)}ct`}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCart((p) => p.filter((x) => x.barcode !== c.barcode));
                  }}
                  aria-label={`Remove ${c.barcode}`}
                  style={{ cursor: 'pointer', color: t.textFaint, font: "600 15px 'Inter'", padding: '0 4px', background: 'transparent', border: 'none' }}
                >
                  x
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.border}` }}>
          <div style={{ font: "600 10.5px 'Inter'", color: t.textFaint, marginBottom: 8 }}>FULFILLMENT</div>
          <div style={{ padding: 9, marginBottom: 8, background: t.bgCard, border: `1px solid ${t.borderLight}`, borderRadius: 8, font: "600 10.5px 'Inter'", color: t.textMuted }}>
            {homeBranch
              ? `Home branch detected automatically: ${homeBranch}. This request will go directly to ${homeBranch} inventory.`
              : 'Add a stone and its home branch will be detected automatically.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, marginBottom: 12 }}>
            {fulfillmentChoicesFor(homeBranch, branch).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setFulfillmentChoice(value);
                }}
                style={{ textAlign: 'left', padding: '8px 9px', borderRadius: 7, border: `1px solid ${fulfillmentChoice === value ? ACCENT : t.borderLight}`, background: fulfillmentChoice === value ? 'oklch(78% 0.13 240 / 0.14)' : t.bgCard, color: fulfillmentChoice === value ? ACCENT : t.textMuted, font: "700 11px 'Inter'", cursor: 'pointer' }}
              >
                {fulfillmentChoiceLabel(value, branch)}
              </button>
            ))}
          </div>
          {fulfillmentChoice === 'bt_to_branch' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, margin: '-5px 0 12px' }}>
              {(['NY', 'LA', 'CH'] as const)
                .filter((candidate) => candidate !== homeBranch)
                .map((candidate) => (
                  <button
                    key={candidate}
                    onClick={() => setDeliveryBranch(candidate)}
                    style={{ padding: '7px 4px', borderRadius: 6, border: `1px solid ${deliveryBranch === candidate ? ACCENT : t.borderLight}`, background: deliveryBranch === candidate ? 'oklch(78% 0.13 240 / 0.14)' : t.bgCard, color: deliveryBranch === candidate ? ACCENT : t.textMuted, font: "700 10.5px 'Inter'", cursor: 'pointer' }}
                  >
                    {candidate}
                  </button>
                ))}
            </div>
          )}
          {deliveryWorkflow && (
            <div style={{ padding: 9, marginBottom: 12, background: 'oklch(70% 0.13 70 / 0.10)', border: '1px solid oklch(70% 0.13 70 / 0.28)', borderRadius: 8 }}>
              {isCrossBranch && <>
                <div style={{ font: "800 10.5px 'Inter'", color: AMBER }}>ERP BRANCH TRANSFER REQUIRED</div>
                <div style={{ font: "500 10px 'Inter'", color: t.textFaint, marginTop: 5 }}>{homeBranch} inventory will be notified to enter the branch transfer in Maitri ERP before packing.</div>
              </>}
              {deliveryRoute === 'customer_ship' && <>
                <div style={{ font: "800 10.5px 'Inter'", color: AMBER, marginTop: 10 }}>DOCUMENTS ARE ADDED LATER</div>
                <div style={{ font: "500 10px 'Inter'", color: t.textFaint, marginTop: 5 }}>
                  {isCrossBranch
                    ? 'After ERP BT receipt, open My requests and upload step 1: invoice/memo paperwork, then step 2: the shipping label.'
                    : 'Open My requests and upload step 1: invoice/memo paperwork, then step 2: the shipping label.'}
                </div>
              </>}
            </div>
          )}
          <div style={{ font: "600 10.5px 'Inter'", color: t.textFaint, marginBottom: 8 }}>REQUEST FOR</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, marginBottom: 12 }}>
            {requestForOptions.map(([value, label]) => (
              <button key={value} onClick={() => setRequestScope(value as RequestScope)} style={{ textAlign: 'left', padding: '7px 9px', borderRadius: 7, border: `1px solid ${requestScope === value ? ACCENT : t.borderLight}`, background: requestScope === value ? 'oklch(78% 0.13 240 / 0.14)' : t.bgCard, color: requestScope === value ? ACCENT : t.textMuted, font: "600 11px 'Inter'", cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
          {cartHasCertlessItem && (
            <div style={{ font: "500 10px 'Inter'", color: t.textFaint, margin: '-6px 0 12px' }}>
              A stone in this request has no certificate on file, so only Stone can be requested.
            </div>
          )}

          {deliveryRoute === 'customer_dropoff' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
              <input value={dropoffCompany} onChange={(e) => setDropoffCompany(e.target.value)} placeholder="Company name" style={{ background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 7, padding: '8px 9px', color: t.text, font: "500 11.5px 'Inter'", outline: 'none' }} />
              <textarea value={dropoffAddress} onChange={(e) => setDropoffAddress(e.target.value)} placeholder="Drop-off address" rows={3} style={{ resize: 'vertical', background: t.bg, border: `1px solid ${t.borderLight}`, borderRadius: 7, padding: '8px 9px', color: t.text, font: "500 11.5px 'Inter'", outline: 'none' }} />
            </div>
          )}
        </div>

        {confirmMsg && <div style={{ marginTop: 12, font: "500 11.5px 'Inter'", color: confirmError ? RED : ACCENT }}>{confirmMsg}</div>}

        <button
          onClick={() => submit(
            cart,
            true,
            cart.some((item) => item.source === 'invoice_upload')
              ? 'invoice_upload'
              : 'manual'
          )}
          disabled={cart.length === 0 || !fulfillmentChoice}
          style={{ marginTop: 14, padding: '11px', borderRadius: 9, border: 'none', background: cart.length && fulfillmentChoice ? ACCENT : t.chipBg, color: cart.length && fulfillmentChoice ? '#0a0e0d' : t.textFaint, font: "600 13px 'Inter'", cursor: cart.length && fulfillmentChoice ? 'pointer' : 'default' }}
        >
          Submit request to inventory
        </button>
      </div>
    </div>
  );
}
