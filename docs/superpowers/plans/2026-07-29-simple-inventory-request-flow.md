# Simple Inventory Request Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create LA and CH inventory accounts and make every inventory request expose one branch-correct current action, including a recovery path for request #1031.

**Architecture:** Keep branch capability rules in small pure functions on both sides of the trust boundary. The frontend uses a typed capability helper to show only relevant controls; the backend independently authorizes every mutation and blocks packing until verification is complete. Account provisioning uses the existing users and sales-reps schema transactionally.

**Tech Stack:** Node.js, Express, PostgreSQL, Next.js 15, React 18, TypeScript, Node test runner, Tauri 2.

## Global Constraints

- Keep the morning Excel snapshot separate from live Maitri ERP actions.
- Use the existing `inventory` role and `NY`, `LA`, `CH` branch codes.
- Show one primary current action per request.
- Do not add source/destination duplicate checkbox columns.
- Preserve existing movement history for request `#1031`.
- Use separate generated temporary passwords and force first-login password changes.
- Preserve the user's existing generated Tauri schema changes and `.claude/` directory.

---

### Task 1: Authorize source-branch item verification

**Files:**
- Modify: `backend/test/requestAuthorization.test.js`
- Modify: `backend/src/services/requestAuthorization.js`

**Interfaces:**
- Consumes: `assertInventoryRequestMutation({ request, actorBranch, mutationField })`
- Produces: branch-and-state authorization for STN/CERT and return mutations

- [ ] **Step 1: Write failing source-verification tests**

Add cases proving NY inventory may update `stone_found` on an NY-to-LA internal
transfer in `awaiting_source`, `packed`, and `shipped_to_destination`; LA may
verify at `ready_for_rep`; CH is rejected; and return authorization remains
destination-only after `handed_to_rep`.

```js
for (const transferStatus of [
  'awaiting_source',
  'packed',
  'shipped_to_destination',
]) {
  assert.doesNotThrow(() => assertInventoryRequestMutation({
    request: {
      status: 'awaiting',
      cross_branch: true,
      fulfillment_branch: 'NY',
      delivery_branch: 'LA',
      delivery_route: 'internal_transfer',
      transfer_status: transferStatus,
    },
    actorBranch: 'NY',
    mutationField: 'stone_found',
  }));
}
```

- [ ] **Step 2: Run the authorization test and verify RED**

Run: `node --test test/requestAuthorization.test.js`

Expected: FAIL because source NY currently receives “Only destination inventory
can confirm stones.”

- [ ] **Step 3: Implement the minimal authorization matrix**

For internal transfers, preserve return handling first. For non-return
mutations, permit the supplying branch during
`awaiting_source|packed|shipped_to_destination` and the destination branch only
at `ready_for_rep`; reject all other combinations with a short error.

- [ ] **Step 4: Run the authorization test and verify GREEN**

Run: `node --test test/requestAuthorization.test.js`

Expected: all authorization tests PASS.

- [ ] **Step 5: Commit the authorization fix**

```powershell
git add -- backend/test/requestAuthorization.test.js backend/src/services/requestAuthorization.js
git commit -m "fix: let supplying inventory verify transfers"
```

### Task 2: Require verification before packing

**Files:**
- Modify: `backend/test/transferService.test.js`
- Modify: `backend/src/services/transferService.js`
- Modify: `backend/src/routes/transfers.js`

**Interfaces:**
- Consumes: `getTransferAction(...)`, request `resolution_confirmed`, and scoped request-stone flags
- Produces: server-enforced verification gate for action `pack`

- [ ] **Step 1: Write the failing packing tests**

Extend the transfer service input with `itemsConfirmed` and
`resolutionConfirmed`. Assert that `pack` fails when either is false and
succeeds when both are true and any required ERP BT is confirmed.

```js
const pack = {
  route: 'internal_transfer',
  status: 'awaiting_source',
  sourceBranch: 'NY',
  destinationBranch: 'LA',
  actorBranch: 'NY',
  action: 'pack',
  requiresErpTransfer: true,
  erpTransferConfirmed: true,
  itemsConfirmed: true,
  resolutionConfirmed: true,
};
assert.equal(getTransferAction(pack), 'packed');
assert.throws(
  () => getTransferAction({ ...pack, itemsConfirmed: false }),
  /stone and certificate/
);
assert.throws(
  () => getTransferAction({ ...pack, resolutionConfirmed: false }),
  /confirm the request/
);
```

- [ ] **Step 2: Run the transfer test and verify RED**

Run: `node --test test/transferService.test.js`

Expected: FAIL because `getTransferAction` currently ignores both verification
flags for packing.

- [ ] **Step 3: Implement the pure pack guard**

Add defaulted boolean inputs to `getTransferAction`. When `action === 'pack'`,
reject incomplete scoped items first and missing resolution second, then apply
the existing ERP BT check.

- [ ] **Step 4: Wire real request state into the route**

In `PATCH /api/transfers/:id/status`, query scoped request-stone flags inside
the existing transaction and derive:

```js
const itemsConfirmed = stones.length > 0 && stones.every((stone) => {
  if (transfer.request_scope === 'stone_only') return stone.stone_found;
  if (transfer.request_scope === 'cert_only') return stone.cert_found;
  return stone.stone_found && stone.cert_found;
});
```

Pass `itemsConfirmed` and `transfer.resolution_confirmed` into
`getTransferAction`. Keep final-delivery validation unchanged.

- [ ] **Step 5: Run focused backend tests and verify GREEN**

Run:
`node --test test/transferService.test.js test/requestAuthorization.test.js`

Expected: all focused tests PASS.

- [ ] **Step 6: Commit the packing gate**

```powershell
git add -- backend/test/transferService.test.js backend/src/services/transferService.js backend/src/routes/transfers.js
git commit -m "fix: require verification before packing"
```

### Task 3: Show one branch-correct current action

**Files:**
- Modify: `frontend/src/lib/requestWorkflow.ts`
- Modify: `frontend/scripts/request-workflow.test.ts`
- Modify: `frontend/src/app/dashboard/requests/page.tsx`
- Modify: `frontend/scripts/request-actions.test.js`

**Interfaces:**
- Produces:
  - `canInventoryConfirmItems(input): boolean`
  - `inventoryTaskMessage(input): string`
- Consumes: authenticated `user.branch` and `RequestSummary`

- [ ] **Step 1: Write failing frontend capability tests**

Add a typed request fixture and assert:

```ts
assert.equal(canInventoryConfirmItems({
  actorBranch: 'NY',
  fulfillmentBranch: 'NY',
  deliveryBranch: 'LA',
  crossBranch: true,
  deliveryRoute: 'internal_transfer',
  transferStatus: 'shipped_to_destination',
  requestStatus: 'awaiting',
}), true);
assert.equal(canInventoryConfirmItems({
  actorBranch: 'CH',
  fulfillmentBranch: 'NY',
  deliveryBranch: 'LA',
  crossBranch: true,
  deliveryRoute: 'internal_transfer',
  transferStatus: 'shipped_to_destination',
  requestStatus: 'awaiting',
}), false);
```

Also assert that the current-task copy identifies NY verification, LA receipt,
and LA handoff stages.

- [ ] **Step 2: Run the frontend workflow test and verify RED**

Run: `npx tsx --test scripts/request-workflow.test.ts`

Expected: FAIL because the capability functions do not exist.

- [ ] **Step 3: Implement the pure frontend capability helpers**

Implement the same source/destination matrix as Task 1. Return concise task
messages such as:

- `Verify the stone and certificate in NY.`
- `Waiting for NY to ship this request.`
- `Receive this shipment in LA.`
- `Hand this request to the sales rep.`

- [ ] **Step 4: Replace the page-local grey-control logic**

Import the helpers into `dashboard/requests/page.tsx`. Use
`canInventoryConfirmItems` for row and bulk STN/CERT controls. Hide irrelevant
checkbox controls instead of rendering them disabled. Require checked items
and resolution before returning the `pack` action from `transferNext`.

Render one task sentence and at most one high-emphasis next-step button. Keep
ERP issue/reject/receive controls visible only to the branch that owns that ERP
step.

- [ ] **Step 5: Add a static regression assertion**

Update `request-actions.test.js` to require the capability helper import and the
current-task message, and to reject the old inline
`internal_transfer ... ready_for_rep`-only expression.

- [ ] **Step 6: Run frontend tests and verify GREEN**

Run: `npm test`

Expected: every frontend JavaScript and TypeScript test PASS.

- [ ] **Step 7: Commit the simple request UI**

```powershell
git add -- frontend/src/lib/requestWorkflow.ts frontend/scripts/request-workflow.test.ts frontend/src/app/dashboard/requests/page.tsx frontend/scripts/request-actions.test.js
git commit -m "fix: simplify branch request actions"
```

### Task 4: Provision LA and CH inventory accounts

**Files:**
- No repository file changes; use the existing production schema and password utilities.

**Interfaces:**
- Consumes: `users`, `sales_reps`, `hashPassword`, `passwordError`, and `withTransaction`
- Produces: active branch-scoped inventory users with `must_change_password = true`

- [ ] **Step 1: Recheck for existing accounts**

Query only `stockla@maitri.nyc` and `stockch@maitri.nyc`. Abort rather than
creating a duplicate profile if either appears between checks.

- [ ] **Step 2: Generate separate strong temporary passwords**

Use `crypto.randomBytes(18).toString('base64url')` and append `Aa1!`; verify each
with `passwordError`.

- [ ] **Step 3: Insert each account transactionally**

For each account, insert `Inventory LA / LA` or `Inventory CH / CH` into
`sales_reps`, hash its unique temporary password, and insert the linked
`inventory` user with `must_change_password = true`.

- [ ] **Step 4: Verify the account records**

Query both accounts and assert:

- role is `inventory`
- branch is respectively `LA` and `CH`
- account is active
- `must_change_password` is true

- [ ] **Step 5: Verify first-login behavior through the production API**

Login once with each temporary credential. Confirm HTTP 200, the returned branch
matches the account, and `mustChangePassword` is true. Do not change either
password.

### Task 5: Audit, verify, deploy, and repair request #1031

**Files:**
- Modify only files required by a concrete failing audit test.

**Interfaces:**
- Consumes: completed Tasks 1–4
- Produces: tested and deployed live workflow

- [ ] **Step 1: Run the request-state audit**

Review every `transferNext`, STN/CERT/RET, ERP BT, paperwork, and final handoff
condition against the authorization matrix. For any additional defect, write a
failing focused test before changing production code.

- [ ] **Step 2: Run the complete backend suite**

Run: `npm test` from `backend`

Expected: zero failures.

- [ ] **Step 3: Run the complete frontend suite and build**

Run from `frontend`:

```powershell
npm test
npm run build
```

Expected: zero test failures and a successful static production export.

- [ ] **Step 4: Run desktop verification**

Run desktop Node tests and Rust tests using the repository's existing commands.
Confirm the native app remains a GUI subsystem build with no terminal window.

- [ ] **Step 5: Commit any focused audit fixes**

Stage only task-owned files. Preserve the user's generated Tauri schemas and
`.claude/` directory.

- [ ] **Step 6: Push and deploy**

Push `master`, manually trigger both Blueprint-managed Render services if they
do not auto-deploy, and wait for the exact pushed commit to become live.

- [ ] **Step 7: Verify production**

Confirm:

- `/health` returns 200
- `/ready` returns database ready
- the hosted app assets return 200
- protected routes return 401 without a token
- both new accounts log in with their correct branches

- [ ] **Step 8: Recover request #1031**

Do not alter its transfer status or history directly. Verify that the live NY
inventory UI/API now permits STN/CERT confirmation while it remains
`shipped_to_destination`; leave the actual checkbox decision to NY inventory
because it certifies physical possession.
