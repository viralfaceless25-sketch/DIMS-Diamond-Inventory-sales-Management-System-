# Conditional Branch-Transfer Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver release 1.0.4 with conditional local/branch-transfer request choices, deferred paperwork and label uploads, supplying-branch integrity fixes, and a clean dependency audit.

**Architecture:** Extend the existing request and transfer records rather than creating a second workflow. The frontend sends a single explicit fulfillment choice; the backend locks current stock, derives and validates all branches, stores the existing canonical route fields, and enforces document and inventory-branch state transitions. Existing requests remain workflow version 1 while new requests use version 2.

**Tech Stack:** Node.js 18+, Express 4, PostgreSQL/Supabase, Next.js 15 static export, React 18, TypeScript, Socket.IO, Tauri 2, Rust, PowerShell NSIS publishing.

## Global Constraints

- Only stock confirmed `available` by the current snapshot or a newer one-time
  home-branch live ERP verification is requestable.
- On Memo, On Hold, In Transit, unknown, and missing snapshot rows remain
  blocked unless home-branch inventory performs that verification.
- One request contains at most 50 unique items and exactly one ERP home branch.
- The default BT destination is the authenticated sales rep's branch.
- Every fulfillment choice supports `stone_and_cert`, `stone_only`, and `cert_only`.
- Source branch is always derived from locked stock rows; client-supplied source data is never trusted.
- Drop-off address is mandatory; company name is optional.
- ERP digital movement and physical movement are separate timelines.
- Source inventory confirms ERP BT issue; destination inventory independently
  confirms ERP BT receipt when the rep needs digital availability.
- Version-2 cross-branch customer shipment order is ERP BT issue, ERP BT
  receipt, paperwork upload, then shipping-label upload.
- Daily Excel data is a timestamped snapshot, not live ERP state. Missing rows
  are archived and blocked instead of deleted or guessed to be In Transit.
- Existing workflow-version-1 requests remain actionable under their original completion rules.
- PDF, PNG, and JPEG uploads are limited to 10 MB and validated by signature.
- Existing installed desktop shells receive hosted web/API changes without reinstalling.
- Do not include or overwrite the pre-existing generated Tauri schema edits in the original checkout.

---

### Task 1: Server-Enforced Fulfillment Choices and Request Integrity

**Files:**
- Modify: `backend/src/services/requestRouting.js`
- Create: `backend/src/services/requestAuthorization.js`
- Modify: `backend/src/services/duplicateService.js`
- Modify: `backend/src/routes/requests.js`
- Modify: `backend/test/requestRouting.test.js`
- Create: `backend/test/requestAuthorization.test.js`
- Create: `backend/test/duplicateService.test.js`

**Interfaces:**
- Produces: `deriveRequestRoute({ homeBranch, repBranch, fulfillmentChoice, deliveryBranch })`
- Produces: `legacyFulfillmentChoice({ homeBranch, repBranch, deliveryRoute })`
- Produces: `assertInventoryRequestMutation({ request, actorBranch })`
- Produces: `getHoldersMap(branch, queryable = pool)` and `getHoldersForBarcodes(branch, barcodes, queryable = pool)`
- Consumes: existing canonical request columns `branch`, `fulfillment_branch`, `delivery_branch`, `cross_branch`, `delivery_route`, and `request_type`

- [ ] **Step 1: Add failing routing tests**

Add literal expectations to `backend/test/requestRouting.test.js`:

```js
test('same-branch stock accepts the four local choices', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'NY',
      repBranch: 'NY',
      fulfillmentChoice: 'local_urgent',
    }),
    {
      fulfillmentBranch: 'NY',
      deliveryBranch: 'NY',
      crossBranch: false,
      deliveryRoute: null,
      requestType: 'urgent',
    }
  );
  assert.equal(deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'local',
  }).requestType, 'local');
  assert.equal(deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'local_ship',
  }).deliveryRoute, 'customer_ship');
  assert.equal(deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'local_dropoff',
  }).deliveryRoute, 'customer_dropoff');
});

test('cross-branch default destination is the authenticated rep branch', () => {
  assert.deepEqual(
    deriveRequestRoute({
      homeBranch: 'LA',
      repBranch: 'NY',
      fulfillmentChoice: 'bt_to_rep_branch',
    }),
    {
      fulfillmentBranch: 'LA',
      deliveryBranch: 'NY',
      crossBranch: true,
      deliveryRoute: 'internal_transfer',
      requestType: 'ship',
    }
  );
});

test('explicit BT destination accepts a real non-source branch only', () => {
  assert.equal(deriveRequestRoute({
    homeBranch: 'LA',
    repBranch: 'NY',
    fulfillmentChoice: 'bt_to_branch',
    deliveryBranch: 'CH',
  }).deliveryBranch, 'CH');
  assert.throws(() => deriveRequestRoute({
    homeBranch: 'LA',
    repBranch: 'NY',
    fulfillmentChoice: 'bt_to_branch',
    deliveryBranch: 'LA',
  }), /different from the stone home branch/);
});

test('local and BT choice sets cannot be used for the wrong stock location', () => {
  assert.throws(() => deriveRequestRoute({
    homeBranch: 'LA',
    repBranch: 'NY',
    fulfillmentChoice: 'local',
  }), /branch-transfer choice/);
  assert.throws(() => deriveRequestRoute({
    homeBranch: 'NY',
    repBranch: 'NY',
    fulfillmentChoice: 'bt_to_rep_branch',
  }), /local choice/);
});
```

- [ ] **Step 2: Run the routing tests and confirm RED**

Run: `node --test test/requestRouting.test.js`

Expected: failures because the current function accepts `deliveryRoute` and always derives pickup/rep-branch routing.

- [ ] **Step 3: Implement the fulfillment-choice derivation**

In `requestRouting.js`, define the exact local and BT sets and map them to canonical fields:

```js
const LOCAL_CHOICES = new Set([
  'local_urgent',
  'local_dropoff',
  'local_ship',
  'local',
]);
const BT_CHOICES = new Set([
  'bt_to_rep_branch',
  'bt_customer_ship',
  'bt_customer_dropoff',
  'bt_to_branch',
]);
```

`deriveRequestRoute` rejects mismatched sets, validates NY/LA/CH, maps local
urgent/local to no delivery route, maps shipment/drop-off to their customer
routes, and uses the rep branch unless `bt_to_branch` supplies a valid
non-source `deliveryBranch`.

Add `legacyFulfillmentChoice` so an already-open 1.0.3 browser can submit during
the rolling backend/frontend deploy:

```js
function legacyFulfillmentChoice({ homeBranch, repBranch, deliveryRoute }) {
  if (homeBranch === repBranch) {
    if (deliveryRoute === 'customer_ship') return 'local_ship';
    if (deliveryRoute === 'customer_dropoff') return 'local_dropoff';
    return 'local';
  }
  if (deliveryRoute === 'customer_ship') return 'bt_customer_ship';
  if (deliveryRoute === 'customer_dropoff') return 'bt_customer_dropoff';
  return 'bt_to_rep_branch';
}
```

- [ ] **Step 4: Add failing inventory-branch and holder-scope tests**

Create `requestAuthorization.test.js`:

```js
test('local request mutations require local inventory', () => {
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: { cross_branch: false, fulfillment_branch: 'NY', branch: 'NY' },
    actorBranch: 'NY',
  }));
  assert.throws(() => assertInventoryRequestMutation({
    request: { cross_branch: false, fulfillment_branch: 'NY', branch: 'NY' },
    actorBranch: 'LA',
  }), /Only NY inventory/);
});
```

Create `duplicateService.test.js` with a queryable that returns one NY rep
holding an LA-supplied request. Assert that requesting the LA holder map includes
the row and requesting NY does not. The fake row must contain the same complete
fields returned by the real query: `barcode`, `request_id`, `sales_rep_id`,
`rep_name`, and `supply_branch`.

- [ ] **Step 5: Run the focused tests and confirm RED**

Run:

```powershell
node --test test/requestAuthorization.test.js test/duplicateService.test.js
```

Expected: missing module/signature failures and the current `r.branch` filter behavior.

- [ ] **Step 6: Implement supplying-branch holder scope and mutation authorization**

Move mutation authorization into `requestAuthorization.js`. Local requests
require `actorBranch === (fulfillment_branch || branch)`; cross-branch behavior
retains the existing route/status-specific source/destination rule.

Update duplicate queries to select:

```sql
COALESCE(r.fulfillment_branch, r.branch) AS supply_branch
```

and scope holders by that value. Accept an optional transaction client so the
same query runs inside request creation.

- [ ] **Step 7: Move stock validation and duplicate recheck inside one locked transaction**

In `POST /api/requests`:

- reject more than 50 submitted entries before normalization;
- reject normalized barcodes longer than 64 characters;
- load and lock loose rows first and jewelry rows second, each ordered by
  barcode with `FOR UPDATE`;
- validate existence, canonical status, and one home branch from locked rows;
- map legacy requests when `fulfillmentChoice` is absent;
- derive the route using the new helper;
- require address for both local and BT drop-off;
- call `getHoldersMap(fulfillmentBranch, client)` after acquiring locks;
- insert only if every barcode is still unheld.

Use the same transaction for the request row, stones, and movement. This makes
the second of two simultaneous requests wait for the first and then see its
new holder.

- [ ] **Step 8: Run backend tests and commit**

Run: `npm test`

Expected: all tests pass.

Commit:

```powershell
git add backend/src/services/requestRouting.js backend/src/services/requestAuthorization.js backend/src/services/duplicateService.js backend/src/routes/requests.js backend/test/requestRouting.test.js backend/test/requestAuthorization.test.js backend/test/duplicateService.test.js
git commit -m "feat: enforce conditional request routing"
```

---

### Task 2: Separate ERP Movement and Preserve Daily Snapshots

**Files:**
- Modify: `backend/src/db/schema.sql`
- Create: `backend/src/services/erpTransferService.js`
- Create: `backend/src/services/stockSnapshotService.js`
- Modify: `backend/src/services/requestStockService.js`
- Modify: `backend/src/services/transferService.js`
- Modify: `backend/src/routes/transfers.js`
- Modify: `backend/src/routes/stock.js`
- Modify: `backend/src/routes/requests.js`
- Modify: `backend/src/routes/tracking.js`
- Create: `backend/src/services/stockRecheckService.js`
- Create: `backend/test/erpTransferService.test.js`
- Create: `backend/test/stockRecheckService.test.js`
- Create: `backend/test/stockSnapshotService.test.js`
- Modify: `backend/test/requestStockService.test.js`
- Modify: `backend/test/transferService.test.js`

**Interfaces:**
- Produces: `assertErpTransferAction({ request, actorBranch, actorRole, action })`
- Produces: `deriveSnapshotReconciliation({ request, stock })`
- Produces: `archiveBranchSnapshot(client, table, branch)`
- Produces: one-time `stock_recheck_requests` authorization records
- Produces: sales-rep and home-branch inventory stock-recheck APIs
- Produces: `POST /api/transfers/:id/request-erp-receive`
- Produces: `POST /api/transfers/:id/erp-received`
- Reinterprets: existing `erp_transfer_confirmed` as ERP BT issued
- Adds: ERP BT received and receive-request actor/timestamp fields
- Adds: stock snapshot active/last-seen/missing-since fields

- [ ] **Step 1: Add failing ERP timeline tests**

Create `erpTransferService.test.js` with literal business rules:

```js
test('only source inventory can confirm ERP BT issue', () => {
  assert.doesNotThrow(() => assertErpTransferAction({
    request: { cross_branch: true, fulfillment_branch: 'LA', delivery_branch: 'NY' },
    actorRole: 'inventory',
    actorBranch: 'LA',
    action: 'issue',
  }));
  assert.throws(() => assertErpTransferAction({
    request: { cross_branch: true, fulfillment_branch: 'LA', delivery_branch: 'NY' },
    actorRole: 'inventory',
    actorBranch: 'NY',
    action: 'issue',
  }), /Only LA inventory/);
});

test('destination receipt is digital, independent of physical arrival', () => {
  assert.doesNotThrow(() => assertErpTransferAction({
    request: {
      cross_branch: true,
      fulfillment_branch: 'LA',
      delivery_branch: 'NY',
      erp_transfer_confirmed: true,
      transfer_status: 'packed',
    },
    actorRole: 'inventory',
    actorBranch: 'NY',
    action: 'receive',
  }));
});

test('ERP BT receipt cannot precede issue', () => {
  assert.throws(() => assertErpTransferAction({
    request: {
      cross_branch: true,
      fulfillment_branch: 'LA',
      delivery_branch: 'NY',
      erp_transfer_confirmed: false,
    },
    actorRole: 'inventory',
    actorBranch: 'NY',
    action: 'receive',
  }), /issued in ERP first/);
});
```

Extend `transferService.test.js` to prove office packing/shipping requires source
BT issue but never destination BT receipt.

- [ ] **Step 2: Add failing snapshot preservation tests**

Create `stockSnapshotService.test.js`:

```js
test('branch replacement archives missing rows instead of deleting them', async () => {
  const calls = [];
  await archiveBranchSnapshot({
    query: async (sql, params) => calls.push({ sql, params }),
  }, 'loose_diamonds', 'LA');
  assert.match(calls[0].sql, /UPDATE loose_diamonds/);
  assert.match(calls[0].sql, /snapshot_active = false/);
  assert.doesNotMatch(calls[0].sql, /DELETE/);
});

test('a missing snapshot does not invent an ERP in-transit event', () => {
  assert.deepEqual(deriveSnapshotReconciliation({
    request: { crossBranch: true, erpTransferIssuedAt: null },
    stock: { snapshotActive: false },
  }), {
    state: 'missing',
    label: 'Not in latest ERP snapshot',
  });
});
```

Extend `requestStockService.test.js` so a locked
`snapshot_active: false` row is blocked with `Not in latest ERP snapshot`.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```powershell
node --test test/erpTransferService.test.js test/stockSnapshotService.test.js test/requestStockService.test.js test/transferService.test.js
```

Expected: missing services/columns and current physical/ERP status coupling.

- [ ] **Step 4: Add the additive ERP and snapshot schema**

Add idempotent request fields:

```sql
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_received BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_received_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_received_by INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_receive_requested_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_receive_requested_by INTEGER REFERENCES users(id);
```

Add to both stock tables:

```sql
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS snapshot_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS snapshot_missing_since TIMESTAMPTZ;
```

Repeat for `jewelry_pieces` and add active/branch indexes. Do not rewrite
existing ERP issue confirmations.

- [ ] **Step 5: Implement ERP issue, receive request, and receipt rules**

Keep `POST /:id/erp-transfer` as the source issue action but rename all response
labels and movements to **ERP BT issued**. Add:

- request-owner `POST /:id/request-erp-receive`;
- destination-inventory `POST /:id/erp-received`.

Receipt requires issue first but does not inspect `transfer_status`; physical
arrival is deliberately irrelevant. Customer-direct routes appear in the
destination receipt queue automatically after issue. Office-route receive
requests add urgency/notification but do not become a hard prerequisite, so
inventory can still record an ERP action initiated outside this app.

Return issued, requested, and received actor/timestamps in all request APIs.

- [ ] **Step 6: Archive and reactivate stock snapshots**

Replace per-branch `DELETE` in the upload transaction with
`archiveBranchSnapshot`. Every upsert explicitly sets:

```sql
snapshot_active = true,
last_seen_at = now(),
snapshot_missing_since = NULL
```

Stock list/count/filter APIs add `snapshot_active = true`. Locked request stock
selects the snapshot fields and refuses inactive rows. The upload response
reports how many prior rows became inactive.

Do not change manual ERP or physical request events during import.

- [ ] **Step 7: Expose snapshot reconciliation without guessing**

Request/tracking queries return last snapshot branch, status, active flag,
last-seen time, and missing-since time. `deriveSnapshotReconciliation` returns:

- `stale` when the latest snapshot predates the manual ERP event;
- `reconciled` when a newer snapshot agrees with issued/received state;
- `mismatch` when a newer snapshot contradicts it;
- `missing` when no manual event justifies an operational interpretation.

Operational cards use manual ERP events for the live timeline and display the
snapshot result separately.

- [ ] **Step 8: Add the live ERP recheck authorization**

Add `stock_recheck_requests` after the request/user tables exist. Each record
stores barcode, item type, requesting rep, derived home branch, captured
snapshot status/time, state, verified live status, verifier/time, optional
note, and consumed request/time.

Add sales-rep endpoints to request a recheck and list their own rechecks. Add
inventory endpoints to list only the actor's home-branch queue and record
`verified_available` or `verified_unavailable`. Derive the home branch from the
preserved stock row; never accept it from the browser.

Request creation locks the matching verification in the same database
transaction as the stock row and active-holder check. A non-available or
inactive snapshot row is accepted only when the verification:

- belongs to the authenticated rep, exact barcode/item, and stored home branch;
- is `verified_available` and unconsumed;
- is newer than the row's `last_seen_at`;
- is then marked consumed with the new request ID before commit.

A successful later stock upload supersedes older verifications without
rewriting them. Source inventory retains the final live ERP check before BT
issue and can record a rejection/current status if availability changed again.

- [ ] **Step 9: Add failing recheck security and concurrency tests**

Prove that sales reps cannot verify, inventory from another branch cannot
verify, verification does not rewrite snapshot facts, an expired or consumed
authorization is rejected, and two concurrent submissions cannot consume one
authorization.

- [ ] **Step 10: Run backend tests and commit**

Run:

```powershell
npm test
node --check src/routes/stock.js
node --check src/routes/transfers.js
node --check src/routes/requests.js
```

Expected: all tests and syntax checks pass.

Commit:

```powershell
git add backend/src/db/schema.sql backend/src/services/erpTransferService.js backend/src/services/stockSnapshotService.js backend/src/services/stockRecheckService.js backend/src/services/requestStockService.js backend/src/services/transferService.js backend/src/routes/transfers.js backend/src/routes/stock.js backend/src/routes/requests.js backend/src/routes/tracking.js backend/test/erpTransferService.test.js backend/test/stockRecheckService.test.js backend/test/stockSnapshotService.test.js backend/test/requestStockService.test.js backend/test/transferService.test.js
git commit -m "feat: separate ERP and physical movement"
```

---

### Task 3: Versioned Paperwork and Label Workflow

**Files:**
- Modify: `backend/src/db/schema.sql`
- Create: `backend/src/services/fileSecurity.js`
- Modify: `backend/src/services/transferService.js`
- Modify: `backend/src/routes/transfers.js`
- Modify: `backend/src/routes/requests.js`
- Create: `backend/test/fileSecurity.test.js`
- Modify: `backend/test/transferService.test.js`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `requests.workflow_version` where existing rows are 1 and new rows are 2
- Produces: `request_paperwork_files(request_id, paperwork_type, file_name, mime_type, file_data, uploaded_by, uploaded_at)`
- Produces: `isSafeDocument(buffer, mimeType)` and `safeDownloadName(name, fallback)`
- Produces: `POST/GET /api/transfers/:id/paperwork`
- Extends: request responses with `workflowVersion` and `hasPaperwork`

- [ ] **Step 1: Add failing file and transfer-state tests**

Create `fileSecurity.test.js`:

```js
test('accepts real PDF PNG and JPEG signatures only', () => {
  assert.equal(isSafeDocument(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
  assert.equal(isSafeDocument(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'image/png'
  ), true);
  assert.equal(isSafeDocument(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'), true);
  assert.equal(isSafeDocument(Buffer.from('not a pdf'), 'application/pdf'), false);
});

test('download filenames cannot inject headers or paths', () => {
  assert.equal(
    safeDownloadName('../invoice\r\nX-Test: yes.pdf', 'paperwork.pdf'),
    'invoiceX-Test yes.pdf'
  );
});
```

Extend `transferService.test.js`:

```js
test('workflow version 2 customer shipment requires paperwork and label', () => {
  const base = {
    route: 'customer_ship',
    status: 'packed',
    sourceBranch: 'LA',
    destinationBranch: 'NY',
    actorBranch: 'LA',
    action: 'ship_customer',
    paperworkType: 'invoice',
    workflowVersion: 2,
    crossBranch: true,
    erpTransferReceived: true,
  };
  assert.throws(() => getTransferAction({
    ...base,
    hasPaperwork: false,
    hasLabel: true,
  }), /paperwork file/);
  assert.throws(() => getTransferAction({
    ...base,
    hasPaperwork: true,
    hasLabel: false,
  }), /shipping label/);
  assert.equal(getTransferAction({
    ...base,
    hasPaperwork: true,
    hasLabel: true,
  }), 'shipped_to_customer');
});

test('workflow version 1 keeps the original completion rule', () => {
  assert.equal(getTransferAction({
    route: 'customer_ship',
    status: 'packed',
    sourceBranch: 'NY',
    destinationBranch: 'NY',
    actorBranch: 'NY',
    action: 'ship_customer',
    hasLabel: true,
    hasPaperwork: false,
    paperworkType: 'none',
    workflowVersion: 1,
  }), 'shipped_to_customer');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
node --test test/fileSecurity.test.js test/transferService.test.js
```

Expected: missing `fileSecurity` and missing workflow-version enforcement.

- [ ] **Step 3: Add the additive schema migration**

Append idempotent SQL:

```sql
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS workflow_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS request_paperwork_files (
  request_id INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  paperwork_type TEXT NOT NULL CHECK (paperwork_type IN ('invoice', 'memo')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_data BYTEA NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

New request inserts explicitly set `workflow_version = 2`. Do not update old rows.

- [ ] **Step 4: Implement signature, filename, and transfer completion rules**

Move the existing signature logic into `fileSecurity.js`, add control/path
character stripping with a 180-character cap, and use it for labels and
paperwork.

Extend `getTransferAction` with `hasPaperwork` and `workflowVersion`. For
`customer_ship` plus `ship_customer`, require:

1. destination ERP BT receipt for a cross-branch workflow-version-2 request;
2. paperwork decision is not pending;
3. workflow version 2 has a stored paperwork file;
4. a stored label exists.

- [ ] **Step 5: Implement paperwork upload/download and ordered label upload**

Use one 10 MB in-memory Multer field for each endpoint and a per-user document
rate limit. `POST /:id/paperwork` accepts form fields:

```text
paperwork=<PDF|PNG|JPEG>
paperworkType=invoice|memo
```

Require request ownership, customer-shipment route, editable transfer state,
and destination ERP BT receipt when cross-branch. Upsert the file and update
`requests.paperwork_type` atomically.

For workflow version 2, `POST /:id/shipping-label` requires `has_paperwork`.
Keep `PATCH /:id/paperwork` only for workflow-version-1 requests.

`GET /:id/paperwork` and the existing label download permit only the request
owner or inventory assigned to source/destination. Use sanitized inline
filenames.

- [ ] **Step 6: Return document state from every request API**

Add `workflow_version` and:

```sql
EXISTS (
  SELECT 1 FROM request_paperwork_files paperwork
  WHERE paperwork.request_id = requests.id
) AS has_paperwork
```

to list, detail, and My Requests queries. Map to `workflowVersion` and
`hasPaperwork` in JSON and TypeScript interfaces.

Add frontend client methods:

```ts
uploadPaperwork(
  requestId: number,
  paperworkType: 'invoice' | 'memo',
  file: File
): Promise<{ ok: true; paperworkType: 'invoice' | 'memo'; fileName: string }>

paperworkUrl(requestId: number): Promise<string>
```

- [ ] **Step 7: Run migration-oriented tests, backend suite, and commit**

Run:

```powershell
npm test
node --check src/routes/transfers.js
node --check src/routes/requests.js
```

Expected: all tests pass and syntax checks exit 0.

Commit:

```powershell
git add backend/src/db/schema.sql backend/src/services/fileSecurity.js backend/src/services/transferService.js backend/src/routes/transfers.js backend/src/routes/requests.js backend/test/fileSecurity.test.js backend/test/transferService.test.js frontend/src/lib/api.ts
git commit -m "feat: add ordered paperwork workflow"
```

---

### Task 4: Conditional Sales-Rep Request Panel and Cross-Branch Invoice Review

**Files:**
- Modify: `frontend/src/lib/requestWorkflow.ts`
- Modify: `frontend/scripts/request-workflow.test.ts`
- Modify: `frontend/src/app/rep/request-stones/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `backend/src/routes/invoice.js`
- Create: `backend/test/invoiceAvailability.test.js`

**Interfaces:**
- Produces: `FulfillmentChoice`
- Produces: `fulfillmentChoices(repBranch, homeBranch)`
- Produces: `defaultFulfillmentChoice(repBranch, homeBranch)`
- Produces: `needsDropoffAddress(choice)` and `needsCustomerDocuments(choice)`
- Consumes: Task 1 request contract and Task 2-3 API types

- [ ] **Step 1: Add failing pure frontend workflow tests**

Add:

```ts
test('same-branch cart exposes only local choices', () => {
  assert.deepEqual(
    fulfillmentChoices('NY', 'NY').map((choice) => choice.value),
    ['local_urgent', 'local_dropoff', 'local_ship', 'local']
  );
});

test('cross-branch cart exposes only BT choices and names the rep branch', () => {
  const choices = fulfillmentChoices('NY', 'LA');
  assert.deepEqual(
    choices.map((choice) => choice.value),
    [
      'bt_to_rep_branch',
      'bt_customer_ship',
      'bt_customer_dropoff',
      'bt_to_branch',
    ]
  );
  assert.match(choices[0].label, /my branch \\(NY\\)/);
});

test('request settings are absent until a home branch is known', () => {
  assert.deepEqual(fulfillmentChoices('NY', null), []);
  assert.equal(defaultFulfillmentChoice('NY', null), null);
});
```

- [ ] **Step 2: Run the workflow test and confirm RED**

Run: `npm exec -- tsx --test scripts/request-workflow.test.ts`

Expected: missing helpers/types.

- [ ] **Step 3: Implement pure conditional-choice helpers**

Replace route-driven panel helpers with `FulfillmentChoice` helpers while
retaining `hasDeliveryWorkflow` for request cards. Labels must match the
approved design exactly and return BT-to-rep as the cross-branch default.

- [ ] **Step 4: Add a failing invoice availability test**

Extract a pure `invoiceAvailability` helper from `invoice.js` and test:

```js
test('available stock at another branch remains requestable', () => {
  assert.deepEqual(
    invoiceAvailability({
      inventory: { branch: 'LA', stock_status: 'available' },
    }),
    {
      available: true,
      reason: null,
      stockBranch: 'LA',
      availabilityLabel: 'Available',
    }
  );
});
```

Run: `node --test test/invoiceAvailability.test.js`

Expected: module/helper missing and current route treats another branch as
`wrong_branch`.

- [ ] **Step 5: Make invoice extraction branch-neutral**

Evaluate requestability from stock existence and canonical status only. Always
return `stockBranch` for inventory matches. Remove the rep-branch comparison
and the unused frontend `branch` form field.

- [ ] **Step 6: Rebuild the request panel around fulfillment choice**

In `request-stones/page.tsx`:

- replace `deliveryRoute`, initial paperwork, and initial label states with
  `fulfillmentChoice` and optional `deliveryBranch`;
- reset choice and incompatible address fields whenever the cart home branch
  changes;
- show no choices before selection;
- show the exact four local or four BT buttons after selection;
- for `bt_to_branch`, show NY/LA/CH and disable the source branch;
- keep scope buttons for every choice;
- show drop-off address and optional company only for drop-off choices;
- submit `fulfillmentChoice`, scope, destination, and address;
- remove request-creation paperwork/label uploads because those now live in My
  Requests.

Group extracted available invoice rows by `stockBranch`. Replace direct send
with one Add-to-cart button per branch group so mixed-home-branch requests
cannot be submitted or silently truncated.

- [ ] **Step 7: Run frontend and invoice tests, build, and commit**

Run:

```powershell
node --test test/invoiceAvailability.test.js
npm test
npm run build
```

Use the backend directory for the first command and frontend directory for the
last two. Expected: tests pass and Next static export succeeds.

Commit:

```powershell
git add backend/src/routes/invoice.js backend/test/invoiceAvailability.test.js frontend/src/lib/requestWorkflow.ts frontend/scripts/request-workflow.test.ts frontend/src/app/rep/request-stones/page.tsx frontend/src/lib/api.ts
git commit -m "feat: show conditional local and BT choices"
```

---

### Task 5: My Requests and Inventory Document Actions

**Files:**
- Modify: `frontend/src/app/rep/my-requests/page.tsx`
- Modify: `frontend/src/app/dashboard/requests/page.tsx`
- Modify: `frontend/src/lib/requestWorkflow.ts`
- Modify: `frontend/scripts/request-actions.test.js`

**Interfaces:**
- Consumes: ERP timeline state from Task 2 plus `workflowVersion`,
  `hasPaperwork`, `hasLabel`, `paperworkType`, and document URLs from Task 3
- Produces: visible two-step document completion in My Requests
- Produces: source-inventory Open paperwork/Open shipping label actions

- [ ] **Step 1: Add failing behavior-contract tests**

Add pure helper assertions to `request-workflow.test.ts`:

```ts
test('version 2 document steps unlock in order', () => {
  assert.deepEqual(documentStepState({
    workflowVersion: 2,
    crossBranch: true,
    erpTransferReceived: false,
    hasPaperwork: false,
    hasLabel: false,
  }), {
    paperworkEnabled: false,
    labelEnabled: false,
    ready: false,
  });
  assert.deepEqual(documentStepState({
    workflowVersion: 2,
    crossBranch: true,
    erpTransferReceived: true,
    hasPaperwork: true,
    hasLabel: false,
  }), {
    paperworkEnabled: true,
    labelEnabled: true,
    ready: false,
  });
});
```

Update `request-actions.test.js` only for route wiring that cannot be exercised
without a browser: assert that both pages call the real API methods
`uploadPaperwork`, `paperworkUrl`, `uploadShippingLabel`, and
`shippingLabelUrl`.

- [ ] **Step 2: Run frontend tests and confirm RED**

Run: `npm test`

Expected: missing `documentStepState`, `uploadPaperwork`, and paperwork-open UI.

- [ ] **Step 3: Implement My Requests steps**

For each customer shipment:

- show Step 1 with Upload invoice and Upload memo;
- disable Step 1 for cross-branch version 2 until destination ERP BT receipt;
- show source ERP BT issued, destination ERP BT received, and physical movement
  as separate status rows;
- allow the rep to request destination ERP BT receipt for an office transfer;
- display/open the current paperwork when present;
- show Step 2 Upload shipping label;
- disable Step 2 for version 2 until paperwork exists;
- preserve version-1 No paperwork/Invoice/Memo decision controls;
- display route, source/destination, scope, drop-off address, transfer state,
  and clear pending tags.

Use hidden file inputs with explicit `{ requestId, paperworkType }` state.
Upload errors remain visible and never clear the request card.

- [ ] **Step 4: Implement inventory document readiness**

In the inventory request page:

- show Open paperwork when `hasPaperwork`;
- show Open shipping label when `hasLabel`;
- show waiting tags for missing version-2 documents;
- hide/disable Ship to customer until `documentStepState(...).ready`;
- keep the backend as final authority;
- display the complete drop-off address;
- retain Copy barcode;
- give source inventory only the ERP BT issued action;
- give destination inventory only the ERP BT received action;
- show physical actions independently from ERP receipt.

- [ ] **Step 5: Run tests/build and commit**

Run:

```powershell
npm test
npm run build
```

Expected: all frontend tests and static export pass.

Commit:

```powershell
git add frontend/src/app/rep/my-requests/page.tsx frontend/src/app/dashboard/requests/page.tsx frontend/src/lib/requestWorkflow.ts frontend/scripts/request-workflow.test.ts frontend/scripts/request-actions.test.js
git commit -m "feat: add request document steps"
```

---

### Task 6: Remove the Excel Upload Dependency Advisory

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/test/stockFileParser.test.js`

**Interfaces:**
- Keeps: `ExcelJS.stream.xlsx.WorkbookReader` behavior used by the worker
- Pins: ExcelJS child dependencies `archiver` 8.0.0 and `unzipper` 0.12.5
- Requires: Node.js `>=18`

- [ ] **Step 1: Record the failing security check**

Run: `npm audit --omit=dev`

Expected before the fix: exit 1 with the brace-expansion advisory through
ExcelJS's old archiver/unzipper tree.

- [ ] **Step 2: Strengthen the XLSX compatibility test before changing dependencies**

Extend the real `stockFileParser.test.js` fixture to write an XLSX using
`ExcelJS.Workbook`, parse it through the production worker-backed
`parseStockFile`, and assert literal jewelry and loose values. This test fails
if the newer archive writer or unzip reader is API-incompatible.

Run: `node --test test/stockFileParser.test.js`

Expected: pass against the current dependency tree, establishing the
compatibility contract before replacement.

- [ ] **Step 3: Pin the patched transitive tree**

Add:

```json
"engines": {
  "node": ">=18"
},
"overrides": {
  "body-parser": "^1.20.6",
  "uuid": "^11.1.1",
  "exceljs": {
    "archiver": "8.0.0",
    "unzipper": "0.12.5"
  }
}
```

Run `npm install` to regenerate the lockfile.

- [ ] **Step 4: Verify the dependency tree, audit, parser, and full backend**

Run:

```powershell
npm ls exceljs archiver unzipper minimatch brace-expansion
npm audit --omit=dev
node --test test/stockFileParser.test.js
npm test
```

Expected: audit exits 0 with zero known vulnerabilities, brace-expansion
resolves to patched 5.0.8 under the archive chain, stock parser tests pass, and
the full backend suite passes.

- [ ] **Step 5: Commit**

```powershell
git add backend/package.json backend/package-lock.json backend/test/stockFileParser.test.js
git commit -m "fix: patch stock upload dependency chain"
```

---

### Task 7: Build and Publish Desktop Release 1.0.4

**Files:**
- Modify: `desktop-app/package.json`
- Modify: `desktop-app/package-lock.json`
- Modify: `desktop-app/src-tauri/Cargo.toml`
- Modify: `desktop-app/src-tauri/Cargo.lock`
- Modify: `desktop-app/src-tauri/tauri.conf.json`
- Modify: `desktop-app/scripts/config.test.js`
- Create: `frontend/public/downloads/DiamondInventory-Setup-1.0.4.exe`
- Modify: `frontend/src/release.json`

**Interfaces:**
- Produces: GUI installer `DiamondInventory-Setup-1.0.4.exe`
- Produces: download metadata containing exact byte length and SHA-256
- Keeps: current-user NSIS installation and WebView2 bootstrap behavior

- [ ] **Step 1: Update the release expectation and confirm RED**

Change the desktop version test literals from `1.0.3` to `1.0.4`.

Run: `npm test`

Expected: failure because package and Tauri config still report 1.0.3.

- [ ] **Step 2: Bump package, Cargo, and Tauri versions**

Run:

```powershell
npm version 1.0.4 --no-git-tag-version
```

Set `Cargo.toml` and `tauri.conf.json` to `1.0.4`, then run `cargo check` so
`Cargo.lock` records package version 1.0.4.

- [ ] **Step 3: Run desktop tests and build**

Run:

```powershell
npm test
cargo test
npm run build
```

Expected: Node and Rust tests pass and NSIS produces:

```text
desktop-app/src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.4_x64-setup.exe
```

- [ ] **Step 4: Publish immutable installer and metadata**

From repository root run:

```powershell
& .\scripts\publish-windows-installer.ps1 `
  -InstallerPath '.\desktop-app\src-tauri\target\release\bundle\nsis\Diamond Inventory_1.0.4_x64-setup.exe' `
  -Version '1.0.4'
```

Run:

```powershell
Get-FileHash '.\frontend\public\downloads\DiamondInventory-Setup-1.0.4.exe' -Algorithm SHA256
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\test_publish_windows_installer.ps1'
```

Verify `release.json` byte length and hash equal the published file.

- [ ] **Step 5: Rebuild frontend and commit release artifacts**

Run: `npm run build` from `frontend`.

Do not stage generated Tauri schema changes.

Commit:

```powershell
git add desktop-app/package.json desktop-app/package-lock.json desktop-app/src-tauri/Cargo.toml desktop-app/src-tauri/Cargo.lock desktop-app/src-tauri/tauri.conf.json desktop-app/scripts/config.test.js frontend/public/downloads/DiamondInventory-Setup-1.0.4.exe frontend/src/release.json
git commit -m "release: publish Diamond Inventory 1.0.4"
```

---

### Task 8: Full Verification, Merge, Deployment, and Live Smoke Test

**Files:**
- Verify: all tracked changes from Tasks 1-7
- Modify only if a verification failure receives its own failing regression test

**Interfaces:**
- Produces: pushed `master` commit consumed by Render auto-deploy
- Verifies: API, database, hosted frontend, remote desktop content, and public installer

- [ ] **Step 1: Run the complete local verification matrix**

Run in parallel where safe:

```powershell
# backend
npm test
npm audit --omit=dev
rg --files src -g '*.js' | ForEach-Object { node --check $_ }

# frontend
npm test
npm audit --omit=dev
npm run build

# desktop
npm test
npm audit --omit=dev
npm run build

# Rust
cargo test

# publisher
powershell -NoProfile -ExecutionPolicy Bypass -File tests/test_publish_windows_installer.ps1
```

Expected: every command exits 0 with zero test or audit failures.

- [ ] **Step 2: Review requirements and repository diff**

Check every Verification bullet in the approved design against a passing test
or build. Run:

```powershell
git diff --check master...HEAD
git status --short
git log --oneline master..HEAD
```

Only intentional feature, test, metadata, and installer files may be present.

- [ ] **Step 3: Merge the isolated branch into master without overwriting user edits**

In the original checkout, confirm the only pre-existing uncommitted files are:

```text
desktop-app/src-tauri/gen/schemas/desktop-schema.json
desktop-app/src-tauri/gen/schemas/windows-schema.json
```

Fast-forward merge the feature branch. If Git reports overlap with either user
file, stop rather than discarding it.

- [ ] **Step 4: Push master and monitor Render**

Run:

```powershell
git push origin master
```

Poll both production endpoints until the new deployment is ready:

```text
https://maitri-inventory-api.onrender.com/health
https://maitri-inventory-api.onrender.com/ready
```

Allow a free-tier cold start before classifying a timeout as failure.

- [ ] **Step 5: Run non-destructive production smoke tests**

Verify:

- API `/health` returns `200 {"ok":true}`;
- API `/ready` returns `200` with database `ready`;
- protected `/api/requests` without a token returns `401`;
- web root and all referenced JS/CSS assets return 200;
- download page contains 1.0.4 and the exact installer filename;
- public installer byte length and SHA-256 match `release.json`.

Do not create, modify, or delete production stock merely for smoke testing.

- [ ] **Step 6: Report release outcome**

Provide:

- deployed commit;
- test/build/audit totals;
- app and download links;
- installer size and SHA-256;
- confirmation that existing desktop users receive the hosted update on next
  open/refresh;
- any remaining operational limitation, including free-tier cold starts and
  unsigned Windows publisher warning.
