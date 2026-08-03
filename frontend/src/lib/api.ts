// Typed client for the backend API. Every call attaches the JWT from the
// auth store. On a 401 it clears the session so the app bounces to /login.

function defaultApiUrl() {
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:4000`;
  }
  return 'http://localhost:4000';
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || defaultApiUrl();

// ---- Types (mirror the backend response shapes) ----

export type Role = 'sales_rep' | 'inventory' | 'admin';

export interface User {
  id: number;
  email: string;
  role: Role;
  salesRepId: number | null;
  name: string | null;
  branch: string | null;
  mustChangePassword: boolean;
}

export interface AdminUser {
  id: number;
  email: string;
  role: Role;
  salesRepId: number | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  createdAt: string;
  repName: string | null;
  branch: string | null;
}

export interface Availability {
  status: 'in_stock' | 'requested' | 'conflict' | 'on_memo' | 'on_hold' | 'in_transit' | 'not_in_snapshot' | string;
  label?: string;
  repName?: string;
  repCount?: number;
  holders?: { requestId: number; repId: number; repName: string }[];
}

export interface StockSnapshot {
  active: boolean;
  branch: string | null;
  stockStatus: string | null;
  lastSeenAt: string | null;
  missingSince: string | null;
}

export interface SnapshotReconciliation {
  state: 'current' | 'missing' | 'stale' | 'reconciled' | 'mismatch';
  label: string;
}

export interface LiveErpVerification {
  id: number;
  snapshotStatus: string | null;
  snapshotActive: boolean;
  snapshotLastSeenAt: string | null;
  verifiedStatus: 'available';
  verifiedAt: string;
  verifiedBy: number | null;
  verifierEmail: string | null;
}

export interface LooseStone {
  barcode: string;
  branch: string;
  lab: string | null;
  certificate_no: string | null;
  shape: string | null;
  carat: number | string | null;
  color: string | null;
  clarity: string | null;
  cut: string | null;
  polish: string | null;
  symmetry: string | null;
  length_mm: number | string | null;
  width_mm: number | string | null;
  height_mm: number | string | null;
  lw_ratio: number | string | null;
  stock_status?: string | null;
  snapshot_active?: boolean;
  last_seen_at?: string | null;
  cost?: number | string | null;
  availability: Availability;
}

export interface JewelryPiece {
  barcode: string;
  branch: string;
  img_link?: string | null;
  video_link?: string | null;
  category: string | null;
  item: string | null;
  ref_no?: string | null;
  metal: string | null;
  metal_weight: number | string | null;
  gross_weight?: number | string | null;
  diamond_cts: number | string | null;
  diamond_pcs: number | null;
  diamond_size?: string | null;
  lab: string | null;
  cert_no: string | null;
  stock_status?: string | null;
  snapshot_active?: boolean;
  last_seen_at?: string | null;
  amount: number | string | null;
  availability: Availability;
}

export interface RequestStone {
  id: number;
  request_id: number;
  barcode: string;
  item_type: 'loose' | 'jewelry';
  stone_found: boolean;
  cert_found: boolean;
  returned: boolean;
  shape: string | null;
  carat: number | string | null;
  color: string | null;
  clarity: string | null;
  cert_no: string | null;
  category: string | null;
  item: string | null;
  duplicate?: boolean;
  duplicateWith?: string[];
  snapshot?: StockSnapshot;
  snapshotReconciliation?: SnapshotReconciliation;
  liveErpVerification?: LiveErpVerification | null;
}

export type BatchStatus = 'awaiting' | 'half_fulfilled' | 'fulfilled' | 'cancelled';

export interface ErpTransferFields {
  workflowVersion: number;
  erpTransferConfirmed: boolean;
  erpTransferConfirmedAt?: string | null;
  erpTransferConfirmedBy?: number | null;
  erpTransferIssued?: boolean;
  erpTransferIssuedAt?: string | null;
  erpTransferIssuedBy?: number | null;
  erpTransferReceived?: boolean;
  erpTransferReceivedAt?: string | null;
  erpTransferReceivedBy?: number | null;
  erpReceiveRequested?: boolean;
  erpReceiveRequestedAt?: string | null;
  erpReceiveRequestedBy?: number | null;
  cancelledAt?: string | null;
  cancelledBy?: number | null;
  cancellationStatus?: string | null;
  cancellationReason?: string | null;
}

export interface RequestSummary extends ErpTransferFields {
  id: number;
  branch: string;
  fulfillmentBranch: string;
  deliveryBranch: string;
  crossBranch: boolean;
  deliveryRoute: 'internal_transfer' | 'customer_ship' | 'customer_dropoff' | null;
  paperworkType: 'none' | 'pending' | 'invoice' | 'memo';
  transferStatus: string | null;
  resolutionConfirmed: boolean;
  hasLabel?: boolean;
  hasPaperwork?: boolean;
  requestedAt: string;
  status: BatchStatus;
  source: string;
  requestScope: 'stone_and_cert' | 'stone_only' | 'cert_only';
  requestType: 'urgent' | 'local' | 'ship' | 'dropoff' | 'pickup';
  dropoffCompany: string | null;
  dropoffAddress: string | null;
  rep: { id: number; name: string };
  stoneCount: number;
  stoneFoundCount: number;
  certFoundCount: number;
  hasDuplicate: boolean;
}

export interface RequestDetail extends ErpTransferFields {
  id: number;
  branch: string;
  fulfillmentBranch: string;
  deliveryBranch: string;
  crossBranch: boolean;
  deliveryRoute: 'internal_transfer' | 'customer_ship' | 'customer_dropoff' | null;
  paperworkType: 'none' | 'pending' | 'invoice' | 'memo';
  transferStatus: string | null;
  resolutionConfirmed: boolean;
  hasLabel?: boolean;
  hasPaperwork?: boolean;
  requestedAt: string;
  status: BatchStatus;
  source: string;
  requestScope: 'stone_and_cert' | 'stone_only' | 'cert_only';
  requestType: 'urgent' | 'local' | 'ship' | 'dropoff' | 'pickup';
  dropoffCompany: string | null;
  dropoffAddress: string | null;
  rep: { id: number; name: string };
  stones: RequestStone[];
}

export interface MyRequest extends Partial<ErpTransferFields> {
  id: number;
  branch: string;
  fulfillmentBranch?: string;
  deliveryBranch?: string;
  crossBranch?: boolean;
  deliveryRoute?: 'internal_transfer' | 'customer_ship' | 'customer_dropoff' | null;
  paperworkType?: 'none' | 'pending' | 'invoice' | 'memo';
  transferStatus?: string | null;
  resolutionConfirmed?: boolean;
  hasLabel?: boolean;
  hasPaperwork?: boolean;
  requestedAt: string;
  status: BatchStatus;
  requestScope?: 'stone_and_cert' | 'stone_only' | 'cert_only';
  requestType?: 'urgent' | 'local' | 'ship' | 'dropoff' | 'pickup';
  dropoffCompany?: string | null;
  dropoffAddress?: string | null;
  stones: RequestStone[];
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RequestStats {
  pendingRequests: number;
  stonesRequested: number;
  duplicateFlags: number;
  fulfilledRequests: number;
  cancelledRequests: number;
}

export interface StockQuery {
  branch: string;
  page?: number;
  pageSize?: number;
  search?: string;
  barcode?: string;
  cert?: string;
  ref?: string;
  shape?: string;
  lab?: string;
  shapes?: string[];
  labs?: string[];
  categories?: string[];
  metals?: string[];
  goldColors?: string[];
  purities?: string[];
  caratMin?: string;
  caratMax?: string;
  colors?: string[];
  clarities?: string[];
  statuses?: string[];
  // 'certified' | 'non_cert' — either, both, or neither selected (both/
  // neither means no filter, same semantics as statuses above).
  certStatuses?: string[];
  requestableOnly?: boolean;
  // 'pick' — loose stones only: available (no ERP hold/memo/transit) sorts
  // before on_hold/on_memo/in_transit, then shape -> carat -> color ->
  // clarity ascending. Omit for the default color-first LOOSE_ORDER that
  // paperwork/sortingService rely on.
  sort?: 'pick';
}

function stockParams(q: StockQuery): string {
  const p = new URLSearchParams({ branch: q.branch });
  if (q.page) p.set('page', String(q.page));
  if (q.pageSize) p.set('pageSize', String(q.pageSize));
  if (q.search) p.set('search', q.search);
  if (q.barcode) p.set('barcode', q.barcode);
  if (q.cert) p.set('cert', q.cert);
  if (q.ref) p.set('ref', q.ref);
  if (q.shape) p.set('shape', q.shape);
  if (q.lab) p.set('lab', q.lab);
  if (q.shapes && q.shapes.length) p.set('shapes', q.shapes.join(','));
  if (q.labs && q.labs.length) p.set('labs', q.labs.join(','));
  if (q.categories && q.categories.length) p.set('categories', q.categories.join(','));
  if (q.metals && q.metals.length) p.set('metals', q.metals.join(','));
  if (q.goldColors && q.goldColors.length) p.set('goldColors', q.goldColors.join(','));
  if (q.purities && q.purities.length) p.set('purities', q.purities.join(','));
  if (q.caratMin) p.set('caratMin', q.caratMin);
  if (q.caratMax) p.set('caratMax', q.caratMax);
  if (q.colors && q.colors.length) p.set('colors', q.colors.join(','));
  if (q.clarities && q.clarities.length) p.set('clarities', q.clarities.join(','));
  if (q.statuses && q.statuses.length) p.set('statuses', q.statuses.join(','));
  if (q.certStatuses && q.certStatuses.length) p.set('certStatuses', q.certStatuses.join(','));
  if (q.requestableOnly) p.set('requestableOnly', 'true');
  if (q.sort) p.set('sort', q.sort);
  return p.toString();
}

export interface TrackingRow {
  id: number;
  barcode: string;
  stone_found: boolean;
  cert_found: boolean;
  returned: boolean;
  request_id: number;
  branch: string;
  fulfillment_branch: string | null;
  delivery_branch: string | null;
  cross_branch: boolean;
  delivery_route: 'internal_transfer' | 'customer_ship' | 'customer_dropoff' | null;
  transfer_status: string | null;
  request_type: 'urgent' | 'local' | 'ship' | 'dropoff' | 'pickup';
  request_status: BatchStatus;
  requested_at: string;
  cancelled_at: string | null;
  cancellation_status: string | null;
  cancellation_reason: string | null;
  erp_transfer_confirmed: boolean;
  erp_transfer_confirmed_at: string | null;
  erp_transfer_received: boolean;
  erp_transfer_received_at: string | null;
  rep_name: string;
  cert_no: string | null;
  current_branch: string;
  current_stock_status: string | null;
  currentStockStatusLabel: string;
  lab: string | null;
  shape: string | null;
  carat: number | string | null;
  color: string | null;
  clarity: string | null;
  category: string | null;
  item: string | null;
  diamond_cts: number | string | null;
  trackingStatus: 'requested' | 'partially_given' | 'with_rep' | 'returned';
  snapshot: StockSnapshot;
  snapshotReconciliation: SnapshotReconciliation;
  liveErpVerification: LiveErpVerification | null;
  movements: TrackingMovement[];
}

export interface TrackingMovement {
  id: number | string;
  movementType: string;
  movementLabel: string;
  fromBranch: string | null;
  toBranch: string | null;
  actorName: string;
  details: Record<string, unknown>;
  createdAt: string;
  historical: boolean;
}

export interface TrackingPage {
  rows: TrackingRow[];
  total: number;
  page: number;
  pageSize: number;
  scope?: 'mine' | 'inventory';
}

export interface ExtractedStone {
  barcode: string;
  shape: string | null;
  carat: number | null;
  color: string | null;
  clarity: string | null;
  certificate_no: string | null;
  item_type: 'loose' | 'jewelry';
  source: 'inventory' | 'invoice';
  available: boolean;
  reason?: 'not_in_stock' | 'wrong_branch' | 'on_memo' | 'on_hold' | string;
  stockBranch?: string | null;
  stock_status?: string | null;
  last_seen_at?: string | null;
  availabilityLabel?: string | null;
  confidence?: 'high' | 'low';
  branch?: string;
}

export interface ExtractResult {
  stones: ExtractedStone[];
  repBranch?: string;
  totalDetected?: number;
  availableCount?: number;
  unavailableCount?: number;
  unavailable?: { barcode: string; reason: string; stockBranch: string | null }[];
  warning?: string;
}

export interface StockRecheck {
  id: number;
  salesRepId: number;
  salesRepName: string | null;
  barcode: string;
  itemType: 'loose' | 'jewelry';
  homeBranch: string;
  state: 'pending' | 'verified_available' | 'verified_unavailable' | 'consumed' | 'cancelled';
  snapshot: {
    active: boolean;
    stockStatus: string | null;
    lastSeenAt: string | null;
  };
  verifiedStatus: string | null;
  note: string | null;
  requestedAt: string;
  verifiedAt: string | null;
  verifiedBy: number | null;
  verifierEmail: string | null;
  consumedAt: string | null;
  consumedRequestId: number | null;
  reused?: boolean;
}

export interface ReceiptCandidate {
  requestId: number;
  requestStoneId: number;
  barcode: string;
  itemType: 'loose' | 'jewelry';
  sourceBranch: string;
  destinationBranch: string;
  requestScope: 'stone_and_cert' | 'stone_only' | 'cert_only';
  transferStatus: string;
  requestStatus: BatchStatus;
  erpTransferConfirmed: boolean;
  erpTransferReceived: boolean;
  rep: { id: number; name: string };
}

export interface PreviousReceipt {
  id: number;
  requestId: number | null;
  requestStoneId: number | null;
  barcode: string;
  stoneReceived: boolean;
  certReceived: boolean;
  matchState: 'matched' | 'unmatched';
  sourceBranch: string;
  receivedOn: string;
  receivedAt: string;
  receivedByEmail: string;
}

export interface ReceiptElsewhereMatch {
  requestId: number;
  sourceBranch: string;
  destinationBranch: string;
  // False for a local pickup or a shipment going straight to a customer —
  // nothing a stockroom will ever receive, as opposed to a genuine
  // misrouted branch shipment.
  receivableAtABranch: boolean;
  rep: { id: number; name: string };
}

export interface ReceiptLookup {
  barcode: string;
  receivingBranch: string;
  candidates: ReceiptCandidate[];
  previousReceipts: PreviousReceipt[];
  elsewhere: ReceiptElsewhereMatch | null;
}

export type ReceiptStatus =
  | 'Needs review'
  | 'Partial arrival'
  | 'Ready for rep'
  | 'Handed over';

export interface ShipmentReceipt {
  id: number;
  receivingBranch: string;
  sourceBranch: string;
  requestId: number | null;
  requestStoneId: number | null;
  barcode: string;
  stoneReceived: boolean;
  certReceived: boolean;
  matchState: 'matched' | 'unmatched';
  receivedOn: string;
  receivedAt: string;
  receivedBy: { id: number; email: string };
  duplicateOverride: boolean;
  workflowMismatch: Record<string, unknown> | null;
  note: string | null;
  correctedAt: string | null;
  correctedByEmail: string | null;
  transferStatus: string | null;
  requestScope: 'stone_and_cert' | 'stone_only' | 'cert_only' | null;
  requestComplete: boolean;
  handedOff: boolean;
  canHandoff: boolean;
  status: ReceiptStatus;
  rep: { id: number; name: string } | null;
}

export interface ReceiptHistory {
  branch: string;
  date: string;
  rows: ShipmentReceipt[];
}

// ---- Token storage (localStorage; fine for a real app, unlike artifacts) ----

const TOKEN_KEY = 'diamond_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

// ---- Core fetch wrapper ----

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  isForm = false
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (!isForm) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'Request failed');
  }
  return data as T;
}

async function requestDocumentUrl(
  requestId: number,
  document: 'shipping-label' | 'paperwork'
): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/transfers/${requestId}/${document}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text();
    let message = document === 'shipping-label'
      ? 'Could not open the shipping label'
      : 'Could not open the invoice or memo paperwork';
    try { message = JSON.parse(text)?.error || message; } catch { /* response is not JSON */ }
    throw new ApiError(res.status, message);
  }
  return URL.createObjectURL(await res.blob());
}

async function requestBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text();
    let message = 'Could not download the file';
    try { message = JSON.parse(text)?.error || message; } catch { /* response is not JSON */ }
    throw new ApiError(res.status, message);
  }
  return res.blob();
}

const shippingLabelUrl = (requestId: number) =>
  requestDocumentUrl(requestId, 'shipping-label');
const paperworkUrl = (requestId: number) =>
  requestDocumentUrl(requestId, 'paperwork');

// ---- Endpoints ----

export const api = {
  apiUrl: API_URL,

  // auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>('/api/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
    }),
  logoutAll: () => request<{ ok: true }>('/api/auth/logout-all', { method: 'POST' }),

  // admin
  adminUsers: () => request<AdminUser[]>('/api/admin/users'),
  createUser: (data: { email: string; password: string; role: Role; repName?: string; branch?: string }) =>
    request<AdminUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  setUserActive: (id: number, isActive: boolean) =>
    request<{ id: number; isActive: boolean }>(`/api/admin/users/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ isActive }),
    }),
  resetUserPassword: (id: number, password: string) =>
    request<{ ok: true }>(`/api/admin/users/${id}/reset-password`, {
      method: 'POST', body: JSON.stringify({ password }),
    }),

  // branches / reps
  branches: () => request<{ id: string; name: string }[]>('/api/branches'),
  reps: () => request<{ id: number; name: string; branch: string }[]>('/api/reps'),

  // stock
  looseStock: (q: StockQuery) =>
    request<Paginated<LooseStone>>(`/api/stock/loose?${stockParams(q)}`),
  jewelryStock: (q: StockQuery) =>
    request<Paginated<JewelryPiece>>(`/api/stock/jewelry?${stockParams(q)}`),
  stockOptions: (branch: string, itemType: 'loose' | 'jewelry') =>
    request<{ shapes: string[]; labs: string[]; categories: string[]; metals: string[]; statuses: string[] }>(
      `/api/stock/options?branch=${encodeURIComponent(branch)}&itemType=${encodeURIComponent(itemType)}`
    ),
  uploadStock: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{
      format: string;
      branchesUpdated: string[];
      rowsImported: number;
      skippedBranches: string[];
      processingMs: number;
    }>('/api/stock/upload', { method: 'POST', body: form }, true);
  },

  // requests (inventory)
  stats: (branch: string) =>
    request<RequestStats>(`/api/requests/stats?branch=${encodeURIComponent(branch)}`),
  requests: (params: { branch: string; view: string; sort: string; search?: string }) => {
    const q = new URLSearchParams({
      branch: params.branch,
      view: params.view,
      sort: params.sort,
      ...(params.search ? { search: params.search } : {}),
    });
    return request<RequestSummary[]>(`/api/requests?${q.toString()}`);
  },
  requestDetail: (id: number) => request<RequestDetail>(`/api/requests/${id}`),
  toggleStone: (requestId: number, stoneId: number, field: string, value: boolean) =>
    request<{ id: number; status: BatchStatus; stones: RequestStone[] }>(
      `/api/requests/${requestId}/stones/${stoneId}`,
      { method: 'PATCH', body: JSON.stringify({ field, value }) }
    ),
  checkAll: (requestId: number, value: boolean, field?: 'stone_found' | 'cert_found' | 'returned') =>
    request<{ id: number; status: BatchStatus; stones: RequestStone[] }>(
      `/api/requests/${requestId}/check-all`,
      { method: 'PATCH', body: JSON.stringify({ value, ...(field ? { field } : {}) }) }
    ),
  confirmResolution: (requestId: number) =>
    request<{ id: number; status: BatchStatus; stones: RequestStone[]; resolutionConfirmed: true }>(
      `/api/requests/${requestId}/confirm-resolution`,
      { method: 'PATCH' }
    ),

  // requests (sales rep)
  myRequests: (repId: number) => request<MyRequest[]>(`/api/requests/by-rep/${repId}`),
  submitRequest: (
    stones: { barcode: string; itemType: string }[],
    source = 'manual',
    options: {
      requestScope?: 'stone_and_cert' | 'stone_only' | 'cert_only';
      requestType?: 'urgent' | 'local' | 'ship' | 'dropoff' | 'pickup';
      dropoffCompany?: string;
      dropoffAddress?: string;
      deliveryRoute?: 'internal_transfer' | 'customer_ship' | 'customer_dropoff';
      paperworkType?: 'none' | 'pending' | 'invoice' | 'memo';
      fulfillmentChoice?:
        | 'local_urgent'
        | 'local_dropoff'
        | 'local_ship'
        | 'local'
        | 'bt_to_rep_branch'
        | 'bt_customer_ship'
        | 'bt_customer_dropoff'
        | 'bt_to_branch';
      deliveryBranch?: 'NY' | 'LA' | 'CH';
    } = {}
  ) =>
    request<{
      id: number;
      branch: string;
      fulfillmentBranch: string;
      deliveryBranch: string;
      crossBranch: boolean;
      deliveryRoute: 'internal_transfer' | 'customer_ship' | 'customer_dropoff' | null;
      workflowVersion: number;
      stones: RequestStone[];
      status: BatchStatus;
    }>(
      '/api/requests',
      { method: 'POST', body: JSON.stringify({ stones, source, ...options }) }
    ),
  uploadShippingLabel: (requestId: number, file: File) => {
    const form = new FormData(); form.append('label', file);
    return request<{ ok: true; requestId: number; hasLabel: true; labelFileName: string }>(`/api/transfers/${requestId}/shipping-label`, { method: 'POST', body: form }, true);
  },
  uploadPaperwork: (requestId: number, paperworkType: 'invoice' | 'memo', file: File) => {
    const form = new FormData();
    form.append('paperworkType', paperworkType);
    form.append('paperwork', file);
    return request<{
      ok: true;
      requestId: number;
      paperworkType: 'invoice' | 'memo';
      hasPaperwork: true;
      paperworkFileName: string;
    }>(`/api/transfers/${requestId}/paperwork`, { method: 'POST', body: form }, true);
  },
  setPaperworkType: (requestId: number, paperworkType: 'none' | 'invoice' | 'memo') =>
    request<{ ok: true; paperworkType: 'none' | 'invoice' | 'memo' }>(`/api/transfers/${requestId}/paperwork`, { method: 'PATCH', body: JSON.stringify({ paperworkType }) }),
  shippingLabelUrl,
  paperworkUrl,
  setTransferStatus: (requestId: number, action: 'pack' | 'ship' | 'receive' | 'ready' | 'hand_to_rep' | 'ship_customer' | 'dropoff_customer') =>
    request<{ transferStatus: string }>(`/api/transfers/${requestId}/status`, { method: 'PATCH', body: JSON.stringify({ action }) }),
  confirmErpTransfer: (requestId: number) =>
    request<{ id: number; erpTransferConfirmed: true }>(`/api/transfers/${requestId}/erp-transfer`, { method: 'PATCH' }),
  requestErpReceive: (requestId: number) =>
    request<{ id: number; erpReceiveRequested: true }>(`/api/transfers/${requestId}/request-erp-receive`, { method: 'PATCH' }),
  confirmErpReceived: (requestId: number) =>
    request<{ id: number; erpTransferReceived: true }>(`/api/transfers/${requestId}/erp-received`, { method: 'PATCH' }),
  rejectErpUnavailable: (requestId: number, liveStatus: string, reason?: string) =>
    request<{
      id: number;
      status: 'cancelled';
      transferStatus: 'cancelled';
      cancellationStatus: string;
      cancellationReason: string | null;
    }>(`/api/transfers/${requestId}/erp-unavailable`, {
      method: 'PATCH',
      body: JSON.stringify({ liveStatus, reason }),
    }),

  // live ERP rechecks bridge status changes that happen after the daily Excel snapshot
  myStockRechecks: () => request<StockRecheck[]>('/api/stock-rechecks/mine'),
  stockRecheckQueue: (state: StockRecheck['state'] = 'pending') =>
    request<{ branch: string; rows: StockRecheck[] }>(
      `/api/stock-rechecks/queue?state=${encodeURIComponent(state)}`
    ),
  requestStockRecheck: (barcode: string, itemType: 'loose' | 'jewelry') =>
    request<StockRecheck>('/api/stock-rechecks', {
      method: 'POST',
      body: JSON.stringify({ barcode, itemType }),
    }),
  resolveStockRecheck: (
    id: number,
    result:
      | { decision: 'available'; note?: string }
      | { decision: 'unavailable'; liveStatus: string; note?: string }
  ) =>
    request<StockRecheck>(`/api/stock-rechecks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(result),
    }),

  // branch shipment receiving (physical arrival only; ERP BT stays separate)
  receiptLookup: (barcode: string) =>
    request<ReceiptLookup>(
      `/api/receipts/lookup?barcode=${encodeURIComponent(barcode)}`
    ),
  receiptHistory: (params: {
    date: string;
    search?: string;
    sourceBranch?: string;
    status?: ReceiptStatus | '';
  }) => {
    const query = new URLSearchParams({ date: params.date });
    if (params.search) query.set('search', params.search);
    if (params.sourceBranch) query.set('sourceBranch', params.sourceBranch);
    if (params.status) query.set('status', params.status);
    return request<ReceiptHistory>(`/api/receipts?${query.toString()}`);
  },
  createReceipt: (data: {
    barcode: string;
    stoneReceived: boolean;
    certReceived: boolean;
    requestStoneId?: number;
    sourceBranch?: string;
    duplicateOverride?: boolean;
    note?: string;
  }) =>
    request<{
      id: number;
      barcode: string;
      requestId: number | null;
      requestStoneId: number | null;
      receivingBranch: string;
      sourceBranch: string;
      matchState: 'matched' | 'unmatched';
      requestComplete: boolean;
      transferStatus: string | null;
      rep: { id: number; name: string } | null;
    }>('/api/receipts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  correctReceipt: (
    id: number,
    data: {
      stoneReceived: boolean;
      certReceived: boolean;
      sourceBranch?: string;
      duplicateOverride?: boolean;
      note?: string;
    }
  ) =>
    request<{
      id: number;
      requestId: number | null;
      requestComplete: boolean;
      transferStatus: string | null;
    }>(`/api/receipts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  linkReceipt: (
    id: number,
    requestStoneId: number,
    duplicateOverride = false
  ) =>
    request<{
      id: number;
      requestId: number;
      requestStoneId: number;
      requestComplete: boolean;
      transferStatus: string;
    }>(`/api/receipts/${id}/link`, {
      method: 'PATCH',
      body: JSON.stringify({ requestStoneId, duplicateOverride }),
    }),
  handReceiptToRep: (requestId: number) =>
    request<{
      requestId: number;
      transferStatus: 'handed_to_rep';
      status: 'fulfilled';
    }>(`/api/receipts/requests/${requestId}/handoff`, {
      method: 'POST',
    }),
  receiptExport: (params: {
    date: string;
    search?: string;
    sourceBranch?: string;
    status?: ReceiptStatus | '';
  }) => {
    const query = new URLSearchParams({ date: params.date });
    if (params.search) query.set('search', params.search);
    if (params.sourceBranch) query.set('sourceBranch', params.sourceBranch);
    if (params.status) query.set('status', params.status);
    return requestBlob(`/api/receipts/export?${query.toString()}`);
  },

  // tracking (inventory)
  tracking: (branch: string, search?: string, page = 1, movement?: string) => {
    const q = new URLSearchParams({ branch, page: String(page), pageSize: '100', ...(search ? { search } : {}) });
    if (movement) q.set('movement', movement);
    return request<TrackingPage>(`/api/tracking?${q.toString()}`);
  },

  // invoice (sales rep)
  extractInvoice: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ExtractResult>('/api/invoice/extract', { method: 'POST', body: form }, true);
  },
};

export { ApiError };
