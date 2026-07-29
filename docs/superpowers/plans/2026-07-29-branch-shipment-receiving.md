# Branch Shipment Receiving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Diamond Inventory 1.0.5 with branch-scoped physical shipment receiving, automatic requester matching, dated receipt history/export, audited handoff, and source-only request resolution.

**Architecture:** Keep source fulfillment on the existing Requests page and add a separate `/dashboard/receiving` destination workflow. A new idempotent Postgres table stores immutable physical receipt events independently from the daily stock snapshot and Maitri ERP digital BT state. Pure receipt-domain functions own validation, date, duplicate, and component-roll-up rules; authenticated API routes own branch scoping, transactions, export, movements, and audit.

**Tech Stack:** Node.js 18+, Express, PostgreSQL, ExcelJS, Next.js 15 static export, React 18, TypeScript, Tauri 2, Rust, Node test runner.

## Global Constraints

- Stone and certificate share one barcode and each receipt records explicit Stone Yes/No and Cert Yes/No.
- At least one received component must be Yes.
- Physical receipt, source request resolution, and Maitri ERP digital BT receipt are independent facts.
- The authenticated inventory profile determines the receiving branch; never trust a client-supplied receiving branch.
- No physical receipt is discarded because of stale Excel data, no match, or an out-of-order internal status.
- Existing production users, stock, requests, documents, audit events, and movement history must be preserved.
- Existing installed EXEs receive hosted frontend/backend changes without reinstalling.
- New-computer installer filename is exactly `DiamondInventory-Setup-1.0.5.exe`.
- Remote web content receives no privileged Tauri capabilities and the release executable remains a GUI process.
- Do not commit passwords, tokens, database URLs, `.env` files, dependency trees, build caches, or private certificates.

---

## File Structure

- `backend/src/db/schema.sql`: idempotent `shipment_receipts` schema and indexes.
- `backend/src/services/receiptService.js`: pure input normalization, branch-local date, expected-component, duplicate, roll-up, and physical-status rules.
- `backend/src/routes/receipts.js`: inventory-authenticated lookup, create, list, correct, link, handoff, and Excel export endpoints.
- `backend/src/services/requestAuthorization.js`: source/destination ownership for source resolution and returns.
- `backend/src/services/movementService.js`: receipt/correction/link/handoff movement labels.
- `backend/src/server.js`: `/api/receipts` route registration.
- `backend/src/db/seedStaff.js`: corrected NY stock email and explicit LA/CH inventory-email defaults.
- `backend/test/receiptService.test.js`: receipt-domain unit tests.
- `backend/test/receiptRoutes.test.js`: schema/route/security/export contract tests.
- `backend/test/requestAuthorization.test.js`: grey-checkbox ownership regression.
- `backend/test/movementService.test.js`: receipt movement-label regression.
- `backend/test/staffSeed.test.js`: inventory-account email regression.
- `frontend/src/lib/receiving.ts`: client-side display status, date navigation, and scan-state helpers.
- `frontend/src/lib/api.ts`: typed receipt API and authenticated Excel-blob download.
- `frontend/src/app/dashboard/receiving/page.tsx`: scanner, match confirmation, daily table, filters, review, handoff, and export UI.
- `frontend/src/app/dashboard/layout.tsx`: Receive Shipments navigation.
- `frontend/src/app/dashboard/requests/page.tsx`: source-only item resolution; no destination physical receiving buttons.
- `frontend/scripts/receiving-page.test.js`: static UI/security contract.
- `frontend/scripts/request-actions.test.js`: source-resolution and removed destination-action contract.
- `frontend/scripts/receiving.test.ts`: pure client-helper tests.
- `desktop-app/package.json`, `desktop-app/package-lock.json`, `desktop-app/src-tauri/Cargo.toml`, `desktop-app/src-tauri/Cargo.lock`, `desktop-app/src-tauri/tauri.conf.json`: release 1.0.5.
- `desktop-app/scripts/config.test.js`: 1.0.5 GUI-shell release contract.
- `frontend/src/release.json`, `frontend/public/downloads/DiamondInventory-Setup-1.0.5.exe`: public release metadata and immutable installer.
- `START-HERE-CODEX-CLAUDE-HANDOFF.md`: operational and development handoff without secrets.

### Task 1: Correct Source-Branch Request Ownership

**Files:**
- Modify: `backend/test/requestAuthorization.test.js`
- Modify: `backend/src/services/requestAuthorization.js`
- Modify: `frontend/scripts/request-actions.test.js`
- Modify: `frontend/src/app/dashboard/requests/page.tsx`

**Interfaces:**
- Consumes: existing `assertInventoryRequestMutation({ request, actorBranch, mutationField })`.
- Produces: source inventory owns Stone/Cert/check-all/confirm-resolution for every route; destination inventory owns only post-handoff return for internal transfers.

- [ ] **Step 1: Write the failing backend ownership tests**

Replace the internal-transfer portion of the ownership test with explicit
source/destination cases:

```js
test('source inventory resolves an internal transfer before shipment', () => {
  const request = {
    cross_branch: true,
    fulfillment_branch: 'NY',
    delivery_branch: 'LA',
    delivery_route: 'internal_transfer',
    transfer_status: 'awaiting_source',
  };
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request, actorBranch: 'NY', mutationField: 'stone_found',
  }));
  assert.throws(() => assertInventoryRequestMutation({
    request, actorBranch: 'LA', mutationField: 'stone_found',
  }), /Only supplying inventory/);
});
```

Keep the existing destination-return test and make it assert that a
`handed_to_rep` return is still destination-owned.

- [ ] **Step 2: Run the focused backend test and verify RED**

Run:

```powershell
cd backend
node --test test/requestAuthorization.test.js
```

Expected: the new NY-source case fails because current code permits LA only at
`ready_for_rep`.

- [ ] **Step 3: Implement source-only resolution authorization**

For `internal_transfer`, treat `returned` separately. Allow a return only from
the destination at `handed_to_rep`; allow other request-stone mutations only
from the source while the transfer is `awaiting_source` or `packed`.

Use these error messages:

```js
'Only destination inventory can record a return after handoff to the sales rep'
'Only supplying inventory can confirm requested stones and certificates before shipment'
```

Keep local-request and direct-customer behavior unchanged.

- [ ] **Step 4: Verify the backend ownership test is GREEN**

Run:

```powershell
cd backend
node --test test/requestAuthorization.test.js
```

Expected: all ownership cases pass.

- [ ] **Step 5: Write the failing frontend ownership contract**

In `frontend/scripts/request-actions.test.js`, require:

```js
assert.match(page, /function canResolveSourceItems/);
assert.match(page, /user\?\.branch === r\.fulfillmentBranch/);
assert.doesNotMatch(page, /label: 'Mark received'/);
assert.doesNotMatch(page, /label: 'Ready for sales rep'/);
```

- [ ] **Step 6: Run the frontend contract and verify RED**

Run:

```powershell
cd frontend
node --test scripts/request-actions.test.js
```

Expected: the source helper is absent and the destination physical actions are
still rendered from Requests.

- [ ] **Step 7: Update the Requests page**

Rename `canConfirmItems` to `canResolveSourceItems`. For internal transfers,
return true only when:

```ts
user?.branch === r.fulfillmentBranch
  && ['awaiting_source', 'packed'].includes(r.transferStatus || 'awaiting_source')
```

Use that helper for Stone, Cert, check-all, and Confirm controls. Remove
`receive`, `ready`, and `hand_to_rep` results from `transferNext`; destination
physical work now lives only on Receive Shipments. Keep customer-shipment and
customer-drop-off source actions intact.

- [ ] **Step 8: Verify focused backend/frontend tests and commit**

Run:

```powershell
cd backend
node --test test/requestAuthorization.test.js
cd ..\frontend
node --test scripts/request-actions.test.js
cd ..
git add backend/test/requestAuthorization.test.js backend/src/services/requestAuthorization.js frontend/scripts/request-actions.test.js frontend/src/app/dashboard/requests/page.tsx
git commit -m "fix: keep request resolution at source branch"
```

Expected: both focused suites pass and the commit contains only ownership/UI
changes.

### Task 2: Add Receipt Domain and Idempotent Schema

**Files:**
- Create: `backend/test/receiptService.test.js`
- Create: `backend/src/services/receiptService.js`
- Modify: `backend/test/deploymentConfig.test.js`
- Modify: `backend/src/db/schema.sql`

**Interfaces:**
- Produces:
  - `normalizeBarcode(value): string`
  - `normalizeReceiptInput(input): { barcode, stoneReceived, certReceived, sourceBranch, requestStoneId, duplicateOverride, note }`
  - `branchLocalDate(branch, at): string`
  - `expectedComponents(scope): { stone: boolean, cert: boolean }`
  - `receiptRollup(requestStones, receipts): { complete, partial, stones }`
  - `nextPhysicalStatus(currentStatus, complete): { status, mismatch }`
  - `duplicateComponents(existingReceipts, input): string[]`

- [ ] **Step 1: Write failing receipt-domain tests**

Cover:

```js
test('receipt requires a normalized barcode and at least one component', () => {
  assert.deepEqual(normalizeReceiptInput({
    barcode: ' 267157-00 ',
    stoneReceived: true,
    certReceived: false,
    sourceBranch: 'ch',
  }), {
    barcode: '267157-00',
    stoneReceived: true,
    certReceived: false,
    sourceBranch: 'CH',
    requestStoneId: null,
    duplicateOverride: false,
    note: null,
  });
  assert.throws(() => normalizeReceiptInput({
    barcode: '267157-00',
    stoneReceived: false,
    certReceived: false,
    sourceBranch: 'CH',
  }), /Stone or certificate/);
});

test('branch dates use the receiving branch timezone', () => {
  const at = new Date('2026-07-30T03:30:00.000Z');
  assert.equal(branchLocalDate('NY', at), '2026-07-29');
  assert.equal(branchLocalDate('LA', at), '2026-07-29');
  assert.equal(branchLocalDate('CH', at), '2026-07-29');
});

test('separate stone and certificate arrivals complete one request stone', () => {
  const result = receiptRollup(
    [{ id: 7, request_scope: 'stone_and_cert' }],
    [
      { request_stone_id: 7, stone_received: false, cert_received: true },
      { request_stone_id: 7, stone_received: true, cert_received: false },
    ]
  );
  assert.equal(result.complete, true);
});
```

Also cover unmatched normalization, invalid branches, note length, partial
roll-up, duplicate component detection, and status catch-up with mismatch.

- [ ] **Step 2: Run the receipt-domain test and verify RED**

Run:

```powershell
cd backend
node --test test/receiptService.test.js
```

Expected: module-not-found failure for `receiptService.js`.

- [ ] **Step 3: Implement the pure receipt service**

Use `Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month:
'2-digit', day: '2-digit' }).formatToParts(at)` to produce an exact
`YYYY-MM-DD`. Accept only `NY`, `LA`, and `CH`; cap barcodes at 64 characters
and notes at 500 characters.

`nextPhysicalStatus` rules:

```js
const preReceive = new Set([
  'awaiting_source', 'packed', 'shipped_to_destination',
  'received_at_destination',
]);
if (!preReceive.has(currentStatus)) return { status: currentStatus, mismatch: null };
return {
  status: complete ? 'ready_for_rep' : 'received_at_destination',
  mismatch: ['shipped_to_destination', 'received_at_destination'].includes(currentStatus)
    ? null
    : { previousTransferStatus: currentStatus, reason: 'physical_arrival_ahead_of_workflow' },
};
```

- [ ] **Step 4: Verify the receipt-domain tests are GREEN**

Run:

```powershell
cd backend
node --test test/receiptService.test.js
```

Expected: all pure-domain tests pass.

- [ ] **Step 5: Add the failing schema contract**

In `deploymentConfig.test.js`, assert that `shipment_receipts` exists after
`users` and `request_stones`, includes the component check, nullable request
links, branch/date fields, correction actor, and unmatched index:

```js
assert.match(schema, /CREATE TABLE IF NOT EXISTS shipment_receipts/);
assert.match(schema, /CHECK \(stone_received OR cert_received\)/);
assert.match(schema, /received_on DATE NOT NULL/);
assert.match(schema, /idx_shipment_receipts_unmatched/);
```

- [ ] **Step 6: Run the schema test and verify RED**

Run:

```powershell
cd backend
node --test test/deploymentConfig.test.js
```

Expected: the receipt-table assertions fail.

- [ ] **Step 7: Add the idempotent receipt schema**

Add `shipment_receipts` after `users`, `requests`, and `request_stones` exist:

```sql
CREATE TABLE IF NOT EXISTS shipment_receipts (
  id BIGSERIAL PRIMARY KEY,
  receiving_branch TEXT NOT NULL REFERENCES branches(id),
  source_branch TEXT NOT NULL REFERENCES branches(id),
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  request_stone_id INTEGER REFERENCES request_stones(id) ON DELETE SET NULL,
  barcode TEXT NOT NULL,
  stone_received BOOLEAN NOT NULL,
  cert_received BOOLEAN NOT NULL,
  match_state TEXT NOT NULL CHECK (match_state IN ('matched', 'unmatched')),
  received_on DATE NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by INTEGER NOT NULL REFERENCES users(id),
  duplicate_override BOOLEAN NOT NULL DEFAULT false,
  workflow_mismatch JSONB,
  note TEXT,
  corrected_at TIMESTAMPTZ,
  corrected_by INTEGER REFERENCES users(id),
  CHECK (stone_received OR cert_received)
);
```

Add indexes for `(receiving_branch, received_on, received_at DESC)`, barcode,
request stone, and unmatched rows.

- [ ] **Step 8: Verify schema/domain tests and commit**

Run:

```powershell
cd backend
node --test test/receiptService.test.js test/deploymentConfig.test.js
cd ..
git add backend/src/db/schema.sql backend/src/services/receiptService.js backend/test/receiptService.test.js backend/test/deploymentConfig.test.js
git commit -m "feat: add shipment receipt domain"
```

Expected: focused tests pass.

### Task 3: Implement Branch-Scoped Receipt API and Export

**Files:**
- Create: `backend/test/receiptRoutes.test.js`
- Create: `backend/src/routes/receipts.js`
- Modify: `backend/src/server.js`
- Modify: `backend/src/services/movementService.js`
- Modify: `backend/test/movementService.test.js`

**Interfaces:**
- Consumes: Task 2 receipt service and existing transaction, audit, movement,
  socket, auth, and ExcelJS utilities.
- Produces:
  - `GET /api/receipts/lookup`
  - `POST /api/receipts`
  - `GET /api/receipts`
  - `PATCH /api/receipts/:id`
  - `PATCH /api/receipts/:id/link`
  - `POST /api/receipts/requests/:requestId/handoff`
  - `GET /api/receipts/export`

- [ ] **Step 1: Write failing route and movement contracts**

`receiptRoutes.test.js` reads route/server source and requires all seven
endpoints, `requireRole('inventory')`, authenticated branch lookup,
`withTransaction`, `ExcelJS.Workbook`, `writeAudit`, and branch broadcasts.
It also asserts that request matching filters:

```js
/delivery_route = 'internal_transfer'/
/COALESCE\(r\.delivery_branch, r\.branch\) = \$2/
/UPPER\(rs\.barcode\) = \$1/
```

Extend `movementService.test.js` to require labels for:

```js
assert.equal(movementLabel('physical_receipt_recorded'), 'Physical receipt recorded');
assert.equal(movementLabel('physical_receipt_corrected'), 'Physical receipt corrected');
assert.equal(movementLabel('physical_receipt_linked'), 'Physical receipt linked');
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd backend
node --test test/receiptRoutes.test.js test/movementService.test.js
```

Expected: route file/registration and new labels are absent.

- [ ] **Step 3: Implement shared route helpers**

In `receipts.js`:

- apply `requireAuth` and `requireRole('inventory')` to the router;
- derive inventory branch through `users -> sales_reps`;
- normalize the barcode before every lookup;
- expose a candidate mapper containing request ID, request-stone ID, source
  branch, rep ID/name, request scope, transfer status, and ERP BT flags;
- use one SQL list query shared by JSON history and Excel export;
- cap search at 100 characters and allow only ISO `YYYY-MM-DD` dates.

- [ ] **Step 4: Implement lookup and create transaction**

Lookup returns:

```json
{
  "barcode": "267157-00",
  "receivingBranch": "NY",
  "candidates": [],
  "previousReceipts": []
}
```

Create locks the selected eligible request/request-stone, derives source and
request IDs server-side, rejects duplicate received components without
`duplicateOverride`, inserts the event, records
`physical_receipt_recorded`, recomputes all request-stone receipts, and moves
the internal physical status to `received_at_destination` or `ready_for_rep`.
Save a stale-status mismatch in `workflow_mismatch`; never change ERP BT
columns.

- [ ] **Step 5: Implement history, correction, linking, and handoff**

- history is always `WHERE receiving_branch = actorBranch`;
- correction retains original `received_at`/`received_by`, sets
  `corrected_at`/`corrected_by`, and audits before/after component values;
- linking locks the unmatched row and an eligible candidate, updates match
  links/state/source, and recomputes readiness;
- handoff locks the request, verifies destination branch, internal route, and
  receipt roll-up completeness, then sets `transfer_status='handed_to_rep'`
  and `status='fulfilled'`;
- movement and audit details include receipt/request IDs but no secrets.

- [ ] **Step 6: Implement Excel export**

Create a workbook named `Received from Branch` with columns:

```js
[
  ['Barcode', 18], ['Stone', 10], ['Cert', 10], ['Location', 12],
  ['Time', 14], ['Request #', 12], ['Sales Rep', 20],
  ['Status', 18], ['Received By', 28],
]
```

Return it with an attachment filename
`Received-Shipments-${branch}-${date}.xlsx`.

- [ ] **Step 7: Register routes, add movement labels, and verify GREEN**

Add:

```js
const receiptsRoute = require('./routes/receipts');
app.use('/api/receipts', receiptsRoute);
```

Run:

```powershell
cd backend
node --test test/receiptRoutes.test.js test/receiptService.test.js test/movementService.test.js test/requestAuthorization.test.js
```

Expected: all focused tests pass.

- [ ] **Step 8: Run the complete backend suite and commit**

Run:

```powershell
cd backend
npm test
cd ..
git add backend/src/server.js backend/src/routes/receipts.js backend/src/services/movementService.js backend/test/receiptRoutes.test.js backend/test/movementService.test.js
git commit -m "feat: add branch shipment receipt API"
```

Expected: all backend tests pass.

### Task 4: Build Typed Receiving Client and Inventory Screen

**Files:**
- Create: `frontend/scripts/receiving.test.ts`
- Create: `frontend/src/lib/receiving.ts`
- Create: `frontend/scripts/receiving-page.test.js`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/app/dashboard/receiving/page.tsx`
- Modify: `frontend/src/app/dashboard/layout.tsx`

**Interfaces:**
- Consumes: Task 3 JSON and XLSX endpoints.
- Produces:
  - `ReceiptCandidate`, `ReceiptLookup`, `ShipmentReceipt`,
    `ReceiptHistory`, and `CreateReceiptInput` API types;
  - `api.receiptLookup`, `api.receipts`, `api.createReceipt`,
    `api.correctReceipt`, `api.linkReceipt`, `api.handoffReceiptRequest`,
    and `api.receiptExportUrl`;
  - branch-scoped receiving page at `/dashboard/receiving`.

- [ ] **Step 1: Write failing pure client-helper tests**

Cover:

```ts
test('receipt status distinguishes unmatched partial ready and handed off', () => {
  assert.equal(receiptDisplayStatus({ matchState: 'unmatched' }), 'Needs review');
  assert.equal(receiptDisplayStatus({ matchState: 'matched', requestComplete: false }), 'Partial arrival');
  assert.equal(receiptDisplayStatus({ matchState: 'matched', requestComplete: true, handedOff: false }), 'Ready for rep');
  assert.equal(receiptDisplayStatus({ matchState: 'matched', requestComplete: true, handedOff: true }), 'Handed over');
});

test('date navigation uses ISO calendar dates without UTC drift', () => {
  assert.equal(shiftIsoDate('2026-07-29', -1), '2026-07-28');
  assert.equal(shiftIsoDate('2026-07-29', 1), '2026-07-30');
});
```

- [ ] **Step 2: Run helper tests and verify RED**

Run:

```powershell
cd frontend
npx tsx --test scripts/receiving.test.ts
```

Expected: module-not-found failure for `src/lib/receiving.ts`.

- [ ] **Step 3: Implement minimal receiving helpers and verify GREEN**

Export `receiptDisplayStatus`, `receiptStatusTone`, `shiftIsoDate`, and
`expectedComponentLabel`. Keep these functions independent from React.

Run:

```powershell
cd frontend
npx tsx --test scripts/receiving.test.ts
```

Expected: helper tests pass.

- [ ] **Step 4: Write the failing receiving-page contract**

Require:

```js
assert.match(layout, /\/dashboard\/receiving/);
assert.match(layout, /Receive Shipments/);
assert.match(page, /Scan received barcode/);
assert.match(page, /Stone received/);
assert.match(page, /Certificate received/);
assert.match(page, /Unmatched - Needs Review/);
assert.match(page, /Handed to/);
assert.match(page, /Export Excel/);
assert.doesNotMatch(page, /receivingBranch:\s*user/);
```

The last assertion prevents sending a client-selected receiving branch.

- [ ] **Step 5: Run the page contract and verify RED**

Run:

```powershell
cd frontend
node --test scripts/receiving-page.test.js
```

Expected: page and navigation are absent.

- [ ] **Step 6: Add typed API methods and blob download**

Add a reusable authenticated `requestBlobUrl(path)` equivalent to document
downloads, then expose:

```ts
receiptLookup: (barcode: string) => ...
receipts: (params: { date: string; search?: string; sourceBranch?: string; status?: string }) => ...
createReceipt: (input: CreateReceiptInput) => ...
correctReceipt: (id: number, input: ReceiptCorrectionInput) => ...
linkReceipt: (id: number, requestStoneId: number) => ...
handoffReceiptRequest: (requestId: number) => ...
receiptExportUrl: (date: string) => ...
```

- [ ] **Step 7: Implement the scanner and match card**

Use a controlled input with `autoFocus`, Enter submit, and a retained ref that
focuses again after lookup/save. Stone and Cert start as `null` and require an
explicit Yes/No selection. Auto-select exactly one match; display a picker for
multiple matches; require a source branch for unmatched.

Do not use a global keydown listener and do not reuse source request
checkboxes.

- [ ] **Step 8: Implement daily history, review, handoff, and export**

Render the approved columns and colors. Refresh through the existing
branch-scoped socket hook. Provide date navigation, search/source/status
filters, unmatched linking, audited correction, and the handoff button only
when `requestComplete && !handedOff`.

Use the blob URL for Excel download and revoke it after the browser begins the
download.

- [ ] **Step 9: Verify frontend tests and production build**

Run:

```powershell
cd frontend
npm test
npm run build
```

Expected: all frontend tests pass and Next static export succeeds with a
`dashboard/receiving/index.html` output.

- [ ] **Step 10: Commit the receiving UI**

Run:

```powershell
cd ..
git add frontend/src/lib/receiving.ts frontend/src/lib/api.ts frontend/src/app/dashboard/receiving/page.tsx frontend/src/app/dashboard/layout.tsx frontend/scripts/receiving.test.ts frontend/scripts/receiving-page.test.js
git commit -m "feat: add inventory receiving dashboard"
```

### Task 5: Create and Verify All Three Inventory Accounts

**Files:**
- Create: `backend/test/staffSeed.test.js`
- Modify: `backend/src/db/seedStaff.js`
- Modify: `START-HERE-CODEX-CLAUDE-HANDOFF.md`

**Interfaces:**
- Produces deterministic inventory emails:
  - NY: `stockny@maitri.nyc`
  - LA: `stockla@maitri.nyc`
  - CH: `stockch@maitri.nyc`
- Passwords remain runtime-only strong temporary values and every new account
  requires a first-login password change.

- [ ] **Step 1: Write the failing staff-seed contract**

Require the three exact emails, three inventory branches, no
`stocstockny@maitri.nyc`, and no password literal:

```js
assert.match(seed, /stockny@maitri\.nyc/);
assert.match(seed, /stockla@maitri\.nyc/);
assert.match(seed, /stockch@maitri\.nyc/);
assert.doesNotMatch(seed, /stocstockny/);
assert.match(seed, /STAFF_INITIAL_PASSWORD/);
```

- [ ] **Step 2: Run the seed test and verify RED**

Run:

```powershell
cd backend
node --test test/staffSeed.test.js
```

Expected: NY typo and missing default LA/CH emails fail.

- [ ] **Step 3: Correct the seed definitions**

Use exact inventory profile names `Inventory NY`, `Inventory LA`, and
`Inventory CH`. Retain idempotent skip behavior and
`must_change_password=true`. Remove the optional-email branch because all
three branches are now required.

- [ ] **Step 4: Verify seed and full backend suites, then commit**

Run:

```powershell
cd backend
node --test test/staffSeed.test.js
npm test
cd ..
git add backend/test/staffSeed.test.js backend/src/db/seedStaff.js
git commit -m "fix: define inventory accounts for every branch"
```

Expected: full backend suite passes.

### Task 6: Release Diamond Inventory 1.0.5

**Files:**
- Modify: `desktop-app/scripts/config.test.js`
- Modify: `frontend/scripts/static-export.test.js`
- Modify: `desktop-app/package.json`
- Modify: `desktop-app/package-lock.json`
- Modify: `desktop-app/src-tauri/Cargo.toml`
- Modify: `desktop-app/src-tauri/Cargo.lock`
- Modify: `desktop-app/src-tauri/tauri.conf.json`
- Create: `frontend/public/downloads/DiamondInventory-Setup-1.0.5.exe`
- Modify: `frontend/src/release.json`

**Interfaces:**
- Produces byte-identical local/public installer and release metadata for
  version 1.0.5.

- [ ] **Step 1: Update release expectations and verify RED**

Change only test expectations from 1.0.4 to 1.0.5:

```powershell
cd desktop-app
npm test
cd ..\frontend
node --test scripts/static-export.test.js
```

Expected: both version assertions fail against current 1.0.4 metadata.

- [ ] **Step 2: Bump Node, Cargo, and Tauri versions**

Run:

```powershell
cd desktop-app
npm version 1.0.5 --no-git-tag-version
cd src-tauri
cargo check
cd ..\..
```

Set `Cargo.toml` and `tauri.conf.json` package versions to `1.0.5` before
`cargo check`, so `Cargo.lock` records the application package version.

- [ ] **Step 3: Verify release configuration**

Run:

```powershell
cd desktop-app
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: 1.0.5 configuration, GUI subsystem, capabilities, and Rust tests all
pass.

- [ ] **Step 4: Build the NSIS installer**

Run:

```powershell
cd desktop-app
npm run build
```

Expected artifact:

```text
desktop-app/src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.5_x64-setup.exe
```

- [ ] **Step 5: Publish and hash the immutable installer**

Run from repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/test_publish_windows_installer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish-windows-installer.ps1 `
  -InstallerPath 'desktop-app/src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.5_x64-setup.exe' `
  -Version '1.0.5'
```

Verify source installer hash, public installer hash, `release.json.sha256`,
and byte size all match.

- [ ] **Step 6: Rebuild the static frontend and commit release artifacts**

Run:

```powershell
cd frontend
npm test
npm run build
cd ..
git add desktop-app/package.json desktop-app/package-lock.json desktop-app/src-tauri/Cargo.toml desktop-app/src-tauri/Cargo.lock desktop-app/src-tauri/tauri.conf.json desktop-app/scripts/config.test.js frontend/scripts/static-export.test.js frontend/src/release.json frontend/public/downloads/DiamondInventory-Setup-1.0.5.exe
git commit -m "release: publish Diamond Inventory 1.0.5"
```

### Task 7: Complete Handoff Documentation and Full Verification

**Files:**
- Create: `START-HERE-CODEX-CLAUDE-HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-07-29-branch-shipment-receiving-design.md`
- Modify: `docs/superpowers/plans/2026-07-29-branch-shipment-receiving.md`

**Interfaces:**
- Produces a self-contained operational handoff and fresh verification
  evidence.

- [ ] **Step 1: Write the handoff**

Document:

- architecture and folder map;
- local setup/test/build commands;
- source vs physical receipt vs ERP BT responsibilities;
- all receipt endpoints and database table;
- inventory account emails without passwords;
- production API, web, download-page, and direct installer URLs;
- Render auto-deploy behavior and cold-start expectations;
- version/hash/size from `release.json`;
- known SmartScreen behavior for the unsigned installer;
- rollback and database-preservation instructions.

- [ ] **Step 2: Run repository hygiene checks**

Run:

```powershell
git diff --check
git status --short
git diff --name-only
rg -n --hidden -S "DATABASE_URL=|JWT_SECRET=|gho_|SUPABASE.*PASSWORD|STAFF_INITIAL_PASSWORD=" `
  -g '!node_modules/**' -g '!target/**' -g '!.git/**' .
```

Expected: no whitespace errors, no unplanned generated files staged, and no
secret values.

- [ ] **Step 3: Run all tests and builds from fresh output state**

Run:

```powershell
cd backend
npm test
cd ..\frontend
npm test
npm run build
cd ..\desktop-app
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cd ..
```

Expected: zero failures and a successful static export.

- [ ] **Step 4: Verify installer bytes**

Run:

```powershell
$source = 'desktop-app/src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.5_x64-setup.exe'
$public = 'frontend/public/downloads/DiamondInventory-Setup-1.0.5.exe'
$metadata = Get-Content -Raw frontend/src/release.json | ConvertFrom-Json
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$publicHash = (Get-FileHash -LiteralPath $public -Algorithm SHA256).Hash
if ($sourceHash -ne $publicHash -or $sourceHash -ne $metadata.sha256) { throw 'Installer checksum mismatch' }
if ((Get-Item -LiteralPath $public).Length -ne $metadata.sizeBytes) { throw 'Installer size mismatch' }
```

Expected: no output/error.

- [ ] **Step 5: Commit documentation**

Run:

```powershell
git add START-HERE-CODEX-CLAUDE-HANDOFF.md docs/superpowers/specs/2026-07-29-branch-shipment-receiving-design.md docs/superpowers/plans/2026-07-29-branch-shipment-receiving.md
git commit -m "docs: hand off shipment receiving release"
```

### Task 8: Publish, Verify Production, and Package Source

**Files:**
- Produces: deployed Git commit and
  `DiamondInventory-Source-Handoff-1.0.5-2026-07-29.zip`.

**Interfaces:**
- Consumes: verified 1.0.5 branch, GitHub origin, Render auto-deploy, and
  administrator-authorized account creation.
- Produces: live API/schema/frontend, public installer, three inventory
  accounts, and an exact-commit source handoff ZIP.

- [ ] **Step 1: Review commits and fast-forward local master**

Run:

```powershell
git log --oneline --decorate master..codex/receive-shipments
git diff --stat master...codex/receive-shipments
git diff --check master...codex/receive-shipments
```

Then, from the main checkout after verifying its unrelated dirty files do not
overlap:

```powershell
git merge --ff-only codex/receive-shipments
```

- [ ] **Step 2: Push the verified master commit**

Run:

```powershell
git push origin master
```

Expected: GitHub accepts the fast-forward and Render starts API/static
auto-deploys.

- [ ] **Step 3: Wait for API migration and frontend deployment**

Poll without replaying application writes:

```powershell
Invoke-RestMethod 'https://maitri-inventory-api.onrender.com/health'
Invoke-RestMethod 'https://maitri-inventory-api.onrender.com/ready'
Invoke-WebRequest -UseBasicParsing 'https://maitri-inventory-web.onrender.com/dashboard/receiving/' -TimeoutSec 180
```

Expected: health and readiness return 200, receiving page contains its static
assets, and no Render failure alert appears.

- [ ] **Step 4: Create or verify LA and CH inventory accounts**

Through the authenticated admin API/UI, verify or create:

- `stockla@maitri.nyc`, role inventory, profile `Inventory LA`, branch LA;
- `stockch@maitri.nyc`, role inventory, profile `Inventory CH`, branch CH.

Use separately generated strong temporary passwords, preserve
`must_change_password=true`, and do not place passwords in Git, logs, ZIPs, or
screenshots. Verify NY is exactly `stockny@maitri.nyc`.

- [ ] **Step 5: Run authenticated production smoke tests**

Using test/admin-authorized inventory sessions:

1. confirm NY, LA, and CH each see only their own receiving branch;
2. lookup one known eligible barcode without saving;
3. confirm an unmatched lookup does not fail;
4. download one date export;
5. confirm source request checkboxes are enabled only at the source;
6. do not create a fake receipt in production merely for smoke testing.

- [ ] **Step 6: Verify public installer**

Download:

```powershell
$download = Join-Path $env:TEMP 'DiamondInventory-Setup-1.0.5.exe'
Invoke-WebRequest -UseBasicParsing 'https://maitri-inventory-web.onrender.com/downloads/DiamondInventory-Setup-1.0.5.exe' -OutFile $download -TimeoutSec 180
Get-FileHash -LiteralPath $download -Algorithm SHA256
```

Expected: hash and byte size match `frontend/src/release.json`.

- [ ] **Step 7: Build and verify the source handoff ZIP**

From the final pushed commit:

```powershell
git archive --format=zip --output 'DiamondInventory-Source-Handoff-1.0.5-2026-07-29.zip' HEAD
```

List the archive and verify it contains source, tests, installer, design,
plan, and handoff; verify it excludes `.env`, `.git`, `node_modules`,
`target`, `.next`, and private credentials. Record its SHA-256.

- [ ] **Step 8: Report exact live deliverables**

Provide:

- public download page;
- direct 1.0.5 EXE URL;
- EXE byte size and SHA-256;
- source-handoff ZIP local path, byte size, and SHA-256;
- live API/web readiness evidence;
- account emails and secure password-delivery instructions;
- confirmation that existing installed users receive hosted workflow changes
  automatically without reinstalling.
