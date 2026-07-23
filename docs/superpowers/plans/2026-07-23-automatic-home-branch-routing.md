# Automatic Home-Branch Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically route every request to the stone's ERP home branch, block unavailable statuses, require cross-branch ERP-transfer confirmation, and publish the update to all hosted-app users.

**Architecture:** Keep the spreadsheet/API inventory as the status and branch source of truth. Extract pure backend routing rules and pure frontend presentation rules so they can be tested without a database or browser, then connect those rules to the existing Express routes and Next.js pages. Persist ERP-transfer confirmation on each request and enforce it in the existing transfer state machine.

**Tech Stack:** Node.js 26 test runner, Express, PostgreSQL/CockroachDB SQL, Next.js 15, React 18, TypeScript, Tauri 2, Render static hosting and web service.

## Global Constraints

- Preserve the unrelated modified Tauri schema files and untracked `.claude/` directory.
- Do not add manual stock-status mutation; ERP remains authoritative.
- Keep `in_transit` supported even though the current workbook does not supply it.
- Only `available` stock can be requested.
- Never trust client-supplied source or destination branches.
- One request may contain stones from exactly one home branch.
- Cross-branch packing requires recorded ERP-transfer confirmation.
- Existing EXE installations receive this release through the hosted frontend/backend.

---

### Task 1: Canonical Stock Statuses

**Files:**
- Create: `backend/test/stockStatus.test.js`
- Modify: `backend/src/services/stockStatus.js`
- Modify: `backend/src/routes/stock.js`
- Modify: `frontend/src/app/dashboard/stock/page.tsx`

**Interfaces:**
- Consumes: raw status strings from spreadsheet uploads, database rows, and query filters.
- Produces: `normalizeStockStatus(value)`, `stockStatusLabel(value)`, and `isRequestableStockStatus(value)`.

- [ ] **Step 1: Write the failing status tests**

```js
test('normalizes current and future ERP status aliases', () => {
  assert.equal(normalizeStockStatus('Available'), 'available');
  assert.equal(normalizeStockStatus('InStock'), 'available');
  assert.equal(normalizeStockStatus('OnMemo'), 'on_memo');
  assert.equal(normalizeStockStatus('OnHold'), 'on_hold');
  assert.equal(normalizeStockStatus('InTransit'), 'in_transit');
  assert.equal(normalizeStockStatus('In Transit'), 'in_transit');
});

test('only available stock is requestable', () => {
  for (const status of ['on_memo', 'on_hold', 'in_transit']) {
    assert.equal(isRequestableStockStatus(status), false);
  }
});
```

- [ ] **Step 2: Verify the new test fails**

Run: `npm test -- test/stockStatus.test.js`

Expected: FAIL because `InTransit` currently normalizes to `intransit`.

- [ ] **Step 3: Implement the canonical mapping**

Add `in transit` and `intransit` aliases to `normalizeStockStatus` and an
explicit `In Transit` label. Return all four canonical values from
`GET /api/stock/options` and add the matching inventory filter chip.

- [ ] **Step 4: Verify status tests pass**

Run: `npm test -- test/stockStatus.test.js`

Expected: PASS.

### Task 2: Automatic Request Routing

**Files:**
- Create: `backend/src/services/requestRouting.js`
- Create: `backend/test/requestRouting.test.js`
- Modify: `backend/src/routes/requests.js`

**Interfaces:**
- Consumes: normalized requested stones with their database `branch`, the authenticated rep branch, and one of `internal_transfer`, `customer_ship`, or `customer_dropoff`.
- Produces:
  - `homeBranchForStock(stones): string`
  - `deriveRequestRoute({ homeBranch, repBranch, deliveryRoute }): { fulfillmentBranch, deliveryBranch, crossBranch, deliveryRoute, requestType }`

- [ ] **Step 1: Write failing routing tests**

```js
test('uses the stone branch as the supplying branch', () => {
  assert.equal(homeBranchForStock([{ barcode: 'A', branch: 'LA' }]), 'LA');
});

test('rejects a request that mixes home branches', () => {
  assert.throws(
    () => homeBranchForStock([{ barcode: 'A', branch: 'LA' }, { barcode: 'B', branch: 'CH' }]),
    /one home branch/
  );
});

test('derives a cross-branch route from stock and rep profiles', () => {
  assert.deepEqual(
    deriveRequestRoute({ homeBranch: 'LA', repBranch: 'NY', deliveryRoute: 'internal_transfer' }),
    {
      fulfillmentBranch: 'LA',
      deliveryBranch: 'NY',
      crossBranch: true,
      deliveryRoute: 'internal_transfer',
      requestType: 'ship',
    }
  );
});
```

- [ ] **Step 2: Verify routing tests fail**

Run: `npm test -- test/requestRouting.test.js`

Expected: FAIL because the new module does not exist.

- [ ] **Step 3: Implement pure routing rules**

Create `requestRouting.js` with allowed branch/route validation, same-branch
handling, mixed-home-branch rejection, and request-type derivation.

- [ ] **Step 4: Verify pure routing tests pass**

Run: `npm test -- test/requestRouting.test.js`

Expected: PASS.

- [ ] **Step 5: Connect POST `/api/requests` to automatic routing**

After loading all stock records:

```js
const homeBranch = homeBranchForStock(normalizedStones.map((stone) => ({
  ...stone,
  branch: stockByKey.get(`${stone.itemType}:${stone.barcode}`)?.branch,
})));
const route = deriveRequestRoute({
  homeBranch,
  repBranch,
  deliveryRoute: req.body.deliveryRoute,
});
```

Use `route.fulfillmentBranch` for duplicate checks, insertion, broadcasts, and
the response. Ignore legacy client-supplied `fulfillmentBranch`,
`deliveryBranch`, and `branch` values. Return a 409 with a clear message for
mixed source branches and retain exact status-specific blocking messages.

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`

Expected: all backend tests PASS.

### Task 3: ERP Branch-Transfer Confirmation

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/services/transferService.js`
- Modify: `backend/test/transferService.test.js`
- Modify: `backend/src/routes/transfers.js`
- Modify: `backend/src/routes/requests.js`

**Interfaces:**
- Adds request fields `erp_transfer_confirmed`, `erp_transfer_confirmed_at`, and `erp_transfer_confirmed_by`.
- Adds `PATCH /api/transfers/:id/erp-transfer`.
- Adds `erpTransferConfirmed` to request summary/detail responses.

- [ ] **Step 1: Add a failing transfer-state test**

```js
test('cross-branch packing requires ERP transfer confirmation', () => {
  assert.throws(
    () => getTransferAction({
      route: 'internal_transfer',
      status: 'awaiting_source',
      sourceBranch: 'LA',
      destinationBranch: 'NY',
      actorBranch: 'LA',
      action: 'pack',
      erpTransferConfirmed: false,
    }),
    /ERP branch transfer/
  );
});
```

- [ ] **Step 2: Verify the transfer test fails**

Run: `npm test -- test/transferService.test.js`

Expected: FAIL because packing is currently allowed without ERP confirmation.

- [ ] **Step 3: Enforce confirmation in the transfer service**

Extend `getTransferAction` with `erpTransferConfirmed = false`. Before returning
`packed` for a cross-branch route, throw `Complete the ERP branch transfer
before packing this request` unless confirmation is true.

- [ ] **Step 4: Verify the transfer service passes**

Run: `npm test -- test/transferService.test.js`

Expected: PASS after existing packing tests explicitly pass
`erpTransferConfirmed: true`.

- [ ] **Step 5: Add persistent, audited confirmation**

Add idempotent schema columns:

```sql
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_confirmed_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_confirmed_by INTEGER REFERENCES users(id);
```

Implement `PATCH /:id/erp-transfer` so it:

- requires inventory role
- locks the request in a transaction
- requires a cross-branch request
- requires the actor's branch to equal `fulfillment_branch`
- records confirmation, timestamp, and actor
- writes an audit event
- broadcasts `transfer:updated`

Include the fields in list, detail, and rep request responses, and pass the
flag into `getTransferAction`.

- [ ] **Step 6: Run backend tests**

Run: `npm test`

Expected: all backend tests PASS.

### Task 4: Sales-Rep Fulfillment UI

**Files:**
- Create: `frontend/src/lib/requestWorkflow.ts`
- Create: `frontend/scripts/request-workflow.test.ts`
- Modify: `frontend/src/app/rep/request-stones/page.tsx`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- `CartItem` includes `branch`.
- `requestWorkflow.ts` exports status labels, cart branch validation, and dynamic fulfillment labels.
- `api.submitRequest` submits stones and fulfillment choice without route branches.

- [ ] **Step 1: Write failing frontend workflow tests**

```ts
test('in-transit availability is explicit and blocked', () => {
  assert.equal(availabilityText({ status: 'in_transit', label: 'In Transit' }), 'In Transit');
  assert.equal(canRequestAvailability({ status: 'in_transit' }), false);
});

test('fulfillment labels use the authenticated rep branch', () => {
  assert.equal(
    fulfillmentLabel('internal_transfer', 'NY', 'LA'),
    'Ship to my branch (NY)'
  );
  assert.equal(
    fulfillmentLabel('internal_transfer', 'NY', 'NY'),
    'Stockroom pickup (NY)'
  );
});

test('a cart cannot mix source branches', () => {
  assert.equal(canAddToHomeBranch('LA', 'CH'), false);
});
```

- [ ] **Step 2: Verify frontend workflow tests fail**

Run: `npm test -- scripts/request-workflow.test.ts`

Expected: FAIL because `requestWorkflow.ts` does not exist.

- [ ] **Step 3: Implement frontend workflow helpers**

Implement the tested helpers with the exact canonical statuses and fulfillment
labels from the design.

- [ ] **Step 4: Verify workflow helpers pass**

Run: `npm test -- scripts/request-workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Replace manual branch-pair controls**

In `request-stones/page.tsx`:

- delete `CROSS_BRANCH_ROUTES`
- remove `fulfillmentBranch` and `deliveryBranch` state
- retain all-branch browsing
- include `branch` in every cart item
- use the first cart item's branch as the automatically displayed home branch
- reject an attempted mixed-branch addition with a clear message
- replace `REQUEST ROUTE` and `REQUEST TYPE` with the three fulfillment choices
- derive local pickup versus cross-branch shipping labels dynamically
- search pasted barcodes across `ALL` branches
- submit only stones and the fulfillment choice
- show `On Memo`, `On Hold`, and `In Transit` blocked reasons

- [ ] **Step 6: Run frontend tests and production build**

Run: `npm test`

Expected: all frontend tests PASS.

Run: `npm run build`

Expected: static export completes successfully.

### Task 5: Inventory ERP Actions and Barcode Copy

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/dashboard/requests/page.tsx`
- Create: `frontend/scripts/request-actions.test.js`

**Interfaces:**
- `api.confirmErpTransfer(requestId)` calls the new backend endpoint.
- Request types expose `erpTransferConfirmed`, confirmation timestamp, and actor.

- [ ] **Step 1: Write a failing static UI contract test**

```js
test('inventory requests expose ERP confirmation and barcode copy actions', () => {
  const page = read('src/app/dashboard/requests/page.tsx');
  assert.match(page, /ERP branch transfer required/);
  assert.match(page, /confirmErpTransfer/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /Copy barcode/);
});
```

- [ ] **Step 2: Verify the action test fails**

Run: `npm test -- scripts/request-actions.test.js`

Expected: FAIL because the actions are not rendered.

- [ ] **Step 3: Add the inventory actions**

For a cross-branch request at the supplying branch:

- display an amber ERP warning until confirmed
- render one `Copy barcode` button beside each barcode
- copy with `navigator.clipboard.writeText`
- show brief copied feedback
- render `Confirm ERP branch transfer completed`
- refresh after confirmation
- disable/hide packing until confirmation
- display a confirmed badge afterward

- [ ] **Step 4: Verify frontend tests and build**

Run: `npm test`

Expected: all frontend tests PASS.

Run: `npm run build`

Expected: static export completes successfully.

### Task 6: Stone Movement History

**Files:**
- Modify: `backend/src/db/schema.sql`
- Create: `backend/src/services/movementService.js`
- Create: `backend/test/movementService.test.js`
- Modify: `backend/src/routes/requests.js`
- Modify: `backend/src/routes/transfers.js`
- Modify: `backend/src/routes/tracking.js`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/dashboard/tracking/page.tsx`
- Create: `frontend/src/app/rep/tracking/page.tsx`
- Modify: `frontend/src/app/rep/layout.tsx`
- Create: `frontend/scripts/tracking-pages.test.js`

**Interfaces:**
- Adds `stone_movements` with request, stone, barcode, actor, branches, event,
  details, and timestamp.
- `recordStoneMovement(queryable, data)` records one event.
- `recordRequestMovement(queryable, requestId, data)` records an event for
  every stone in a request.
- `GET /api/tracking` scopes inventory to selected branches and sales reps to
  their own `sales_rep_id`.

- [ ] **Step 1: Write failing movement tests**

```js
test('movement labels cover the request lifecycle', () => {
  assert.equal(movementLabel('requested'), 'Requested');
  assert.equal(movementLabel('branch_transfer_sent'), 'Branch transfer sent');
  assert.equal(movementLabel('branch_transfer_received'), 'Branch transfer received');
  assert.equal(movementLabel('returned'), 'Returned');
});

test('transfer actions map to movement events', () => {
  assert.equal(movementForTransferAction('ship'), 'branch_transfer_sent');
  assert.equal(movementForTransferAction('receive'), 'branch_transfer_received');
  assert.equal(movementForTransferAction('hand_to_rep'), 'handed_to_rep');
});
```

- [ ] **Step 2: Verify movement tests fail**

Run: `npm test -- test/movementService.test.js`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the event model and recording service**

Create an idempotent `stone_movements` table and indexes on barcode, request,
rep, and created time. Implement parameterized inserts for single-stone and
whole-request movements plus stable label/action mappings.

- [ ] **Step 4: Verify movement service tests pass**

Run: `npm test -- test/movementService.test.js`

Expected: PASS.

- [ ] **Step 5: Record lifecycle movements transactionally**

Record:

- `requested` while inserting each request stone
- `erp_transfer_recorded` with ERP confirmation
- transfer action movements in the same transaction as transfer status
- `stone_confirmed`, `certificate_confirmed`, and `returned` only on false-to-true changes

The movement write must use the same transaction client as the state change so
history cannot claim a movement that failed to commit.

- [ ] **Step 6: Upgrade the tracking API securely**

Return current stone summary fields and a chronological `movements` array.
Inventory may filter by any branch. For a sales-rep token, append
`r.sales_rep_id = req.user.salesRepId` server-side and ignore any client rep ID.
Support barcode/certificate search, movement filter, and pagination.

- [ ] **Step 7: Write failing tracking-page contracts**

```js
test('inventory tracking renders movement history controls', () => {
  const page = read('src/app/dashboard/tracking/page.tsx');
  assert.match(page, /Stone movement history/);
  assert.match(page, /MOVEMENT/);
  assert.match(page, /FROM/);
  assert.match(page, /TO/);
});

test('sales reps have a scoped tracking page', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/app/rep/tracking/page.tsx')), true);
  assert.match(read('src/app/rep/layout.tsx'), /\/rep\/tracking/);
});
```

- [ ] **Step 8: Verify tracking-page tests fail**

Run: `npm test -- scripts/tracking-pages.test.js`

Expected: FAIL because the upgraded and rep tracking pages do not exist.

- [ ] **Step 9: Build inventory and sales-rep tracking views**

Inventory view:

- barcode and certificate search
- branch and movement filtering
- current stone/request summary
- expandable newest-first movement timeline
- request number, actor, from/to branches, certificate state, and timestamp

Sales-rep view:

- the same current status and movement labels
- only the authenticated rep's requests
- no inventory-only global branch selector
- links back to the rep's request number

- [ ] **Step 10: Run backend/frontend verification**

Run in `backend`: `npm test`

Expected: all backend tests PASS.

Run in `frontend`: `npm test` and `npm run build`

Expected: all frontend tests PASS and static export succeeds.

### Task 7: Release 1.0.3 and Remote Delivery

**Files:**
- Modify: `desktop-app/package.json`
- Modify: `desktop-app/package-lock.json`
- Modify: `desktop-app/src-tauri/Cargo.toml`
- Modify: `desktop-app/src-tauri/tauri.conf.json`
- Modify: `desktop-app/scripts/config.test.js`
- Modify: `frontend/src/release.json`
- Modify: `frontend/scripts/static-export.test.js`

**Interfaces:**
- Produces `DiamondInventory-Setup-1.0.3.exe`.
- Keeps the existing hosted-app desktop architecture; no new Tauri capability is added.

- [ ] **Step 1: Update release tests to expect 1.0.3**

Change desktop config assertions and the public download metadata expectation to
version `1.0.3`.

- [ ] **Step 2: Verify release tests fail**

Run in `desktop-app`: `npm test`

Expected: FAIL because configurations still say 1.0.2.

- [ ] **Step 3: Bump release metadata**

Set version `1.0.3` consistently in NPM, Cargo, Tauri, and frontend release
metadata. Point the public download URL at
`/downloads/DiamondInventory-Setup-1.0.3.exe`; leave SHA-256 blank until the
installer is built.

- [ ] **Step 4: Verify desktop configuration**

Run in `desktop-app`: `npm test`

Expected: all desktop configuration tests PASS.

Run in `desktop-app/src-tauri`: `cargo test`

Expected: Rust tests PASS.

- [ ] **Step 5: Build and verify the installer**

Run in `desktop-app`: `npm run build`

Expected: Tauri produces the NSIS setup executable.

Calculate SHA-256 with:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<installer-path>'
```

Update `frontend/src/release.json`, rerun frontend tests/build, and verify the
downloaded EXE size and hash match the local artifact.

### Task 8: Full Verification and Deployment

**Files:**
- No new source files; deployment updates Render/GitHub state.

**Interfaces:**
- Publishes API, static frontend, release metadata, and installer.

- [ ] **Step 1: Run all local verification**

Run:

```powershell
Set-Location backend
npm test
Set-Location ..\frontend
npm test
npm run build
Set-Location ..\desktop-app
npm test
npm run build
Set-Location src-tauri
cargo test
```

Expected: every command exits 0.

- [ ] **Step 2: Verify preserved user changes**

Run: `git status --short`

Expected: the pre-existing Tauri schema modifications and `.claude/` remain
untouched and are not included in the feature diff.

- [ ] **Step 3: Deploy backend and frontend**

Push only the feature/release files to the configured GitHub repository, deploy
the Render API and static site, and upload the 1.0.3 installer to the public
downloads path.

- [ ] **Step 4: Verify live behavior**

Confirm:

- API readiness succeeds
- existing users load the updated hosted UI
- explicit branch-pair controls are absent
- in-transit status renders correctly
- an available cross-branch test request routes to the stone home branch
- ERP confirmation gates packing
- barcode copy works
- inventory movement history shows the request lifecycle
- sales-rep tracking is restricted to the authenticated rep
- public 1.0.3 EXE returns HTTP 200 and matches the published SHA-256

- [ ] **Step 5: Report deployment**

Provide the public installer link, SHA-256, live site/API links, automatic
update behavior, and any unavoidable native-shell reinstall limitation.
