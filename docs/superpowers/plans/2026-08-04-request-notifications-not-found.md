# Request Notifications and Not-Found Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver correctly targeted temporary request notifications and an explicit, audited Not Found resolution for local and cross-branch requests.

**Architecture:** Persist lifecycle transitions in PostgreSQL, route transient events through server-controlled Socket.IO rooms, and render them through one reusable toast host mounted in both application shells. Keep `returned` unchanged and model `not_found` independently, with transactional mutual exclusion and explicit completion checks.

**Tech Stack:** Node.js 18+, Express, PostgreSQL, Socket.IO 4, Next.js 15, React 18, TypeScript, Node test runner.

## Global Constraints

- Popups last approximately ten seconds, queue, are dismissible, clickable, and accessible.
- Popup events are not replayed after reconnect; request lifecycle state remains durable.
- Local requests notify their fulfillment inventory once; cross-branch requests notify only source/fulfillment inventory.
- Viewed and confirmed events reach only the requesting sales user's authenticated room.
- A view occurs only after an authorized inventory user expands and loads request details.
- Keep `request_stones.returned` and the existing return workflow unchanged.
- `Not Found` is mutually exclusive with STN/CERT; combined requests permit STN-only or CERT-only partial results.
- `Not Found` is enabled on every authorized active resolution row and must not inherit the old RET control's disabled-state rules.
- Confirmation rejects every row lacking an explicit resolution.
- Every behavior change follows red-green-refactor and preserves branch authorization.

---

### Task 1: Persist explicit resolution and lifecycle state

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/services/resolutionService.js`
- Modify: `backend/test/deploymentConfig.test.js`
- Modify: `backend/test/resolutionService.test.js`

**Interfaces:**
- Produces: `isStoneDeliberatelyResolved(stone, requestScope): boolean`
- Produces: `canConfirmResolution(stones, requestScope): boolean`
- Adds request fields `inventory_viewed_at`, `inventory_viewed_by`, `resolution_confirmed_at`, `resolution_confirmed_by`
- Adds stone fields `not_found`, `not_found_at`, `not_found_by`

- [ ] **Step 1: Write failing schema and resolution tests**

```js
test('not found explicitly resolves an otherwise missing row', () => {
  assert.equal(canConfirmResolution([
    { stone_found: false, cert_found: false, not_found: true },
  ], 'stone_and_cert'), true);
});

test('combined requests permit deliberate partial results', () => {
  assert.equal(canConfirmResolution([
    { stone_found: true, cert_found: false, not_found: false },
  ], 'stone_and_cert'), true);
});

test('an untouched row cannot be confirmed', () => {
  assert.equal(canConfirmResolution([
    { stone_found: false, cert_found: false, not_found: false },
  ], 'stone_and_cert'), false);
});
```

Assert the schema contains all seven additive columns and foreign keys to
`users(id)` for actor fields.

- [ ] **Step 2: Run the focused tests and verify missing exports/columns fail**

Run: `cd backend && node --test test/resolutionService.test.js test/deploymentConfig.test.js`

- [ ] **Step 3: Add additive schema columns and minimal pure resolution helpers**

```js
function isStoneDeliberatelyResolved(stone, requestScope) {
  if (stone.not_found) return true;
  if (requestScope === 'stone_only') return Boolean(stone.stone_found);
  if (requestScope === 'cert_only') return Boolean(stone.cert_found);
  return Boolean(stone.stone_found || stone.cert_found);
}

function canConfirmResolution(stones, requestScope) {
  return stones.length > 0
    && stones.every((stone) => isStoneDeliberatelyResolved(stone, requestScope));
}
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `cd backend && node --test test/resolutionService.test.js test/deploymentConfig.test.js`

- [ ] **Step 5: Commit the schema and resolution contract**

```bash
git add backend/src/db/schema.sql backend/src/services/resolutionService.js backend/test/deploymentConfig.test.js backend/test/resolutionService.test.js
git commit -m "feat(requests): add explicit resolution state"
```

### Task 2: Add protected notification rooms and emitters

**Files:**
- Modify: `backend/src/sockets/index.js`
- Modify: `backend/test/socketAuthorization.test.js`
- Create: `backend/src/services/requestNotificationService.js`
- Create: `backend/test/requestNotificationService.test.js`

**Interfaces:**
- Produces: `userRoom(userId): string`
- Produces: `inventoryRoom(branch): string`
- Produces: `emitToUser(userId, event, payload): void`
- Produces: `emitToInventory(branch, event, payload): void`
- Produces: `buildRequestCreatedNotification(request, stones): RequestNotificationPayload`

- [ ] **Step 1: Write failing room and payload tests**

```js
test('server rooms are derived from authenticated identity', () => {
  assert.deepEqual(automaticRooms({ id: 7, role: 'inventory', branch: 'NY' }),
    ['user:7', 'inventory:NY']);
  assert.deepEqual(automaticRooms({ id: 8, role: 'sales_rep', branch: 'NY' }),
    ['user:8']);
});

test('request preview is bounded to three barcodes', () => {
  const payload = buildRequestCreatedNotification(
    { id: 41, repName: 'Asha', repBranch: 'LA', requestType: 'local' },
    ['A', 'B', 'C', 'D'].map((barcode) => ({ barcode }))
  );
  assert.deepEqual(payload.previewBarcodes, ['A', 'B', 'C']);
  assert.equal(payload.remainingCount, 1);
});
```

- [ ] **Step 2: Run tests and verify the new interfaces are absent**

Run: `cd backend && node --test test/socketAuthorization.test.js test/requestNotificationService.test.js`

- [ ] **Step 3: Join automatic rooms on authenticated connection and add narrow emit helpers**

```js
function automaticRooms(user) {
  const rooms = [`user:${Number(user.id)}`];
  if (user.role === 'inventory' && user.branch) rooms.push(`inventory:${user.branch}`);
  return rooms;
}

function emitToUser(userId, event, payload) {
  if (io) io.to(userRoom(userId)).emit(event, payload);
}

function emitToInventory(branch, event, payload) {
  if (io) io.to(inventoryRoom(branch)).emit(event, payload);
}
```

Join these rooms directly inside `connection`; do not expose a client event
that accepts their names.

- [ ] **Step 4: Run focused socket and notification tests**

Run: `cd backend && node --test test/socketAuthorization.test.js test/requestNotificationService.test.js`

- [ ] **Step 5: Commit targeted realtime routing**

```bash
git add backend/src/sockets/index.js backend/src/services/requestNotificationService.js backend/test/socketAuthorization.test.js backend/test/requestNotificationService.test.js
git commit -m "feat(socket): target request notifications"
```

### Task 3: Implement viewed, confirmed, and Not Found request transitions

**Files:**
- Modify: `backend/src/routes/requests.js`
- Create: `backend/test/requestNotificationRoutes.test.js`
- Create: `backend/test/notFoundRoutes.test.js`

**Interfaces:**
- Adds: `POST /api/requests/:id/viewed` returning `{ id, inventoryViewedAt, inventoryViewedBy, firstView }`
- Extends: stone mutation field union with `not_found`
- Extends: request response objects with lifecycle fields and stone not-found fields
- Consumes: `emitToInventory`, `emitToUser`, `buildRequestCreatedNotification`, `canConfirmResolution`

- [ ] **Step 1: Write failing route/service-boundary tests**

Use injected fake query clients to prove these observable behaviors:

```js
assert.equal(firstViewResponse.firstView, true);
assert.equal(secondViewResponse.firstView, false);
assert.equal(emittedViewedEvents.length, 1);
assert.equal(emittedViewedEvents[0].room, `user:${requestingUserId}`);
assert.equal(createdEvents[0].room, `inventory:${fulfillmentBranch}`);
```

Also assert unauthorized inventory receives 403, `not_found=true` clears both
found flags, found=true clears `not_found`, unresolved confirmation returns 409,
row and bulk mutations persist after a refetch, and confirmation emits once to
the requesting user's room.

- [ ] **Step 2: Run route tests and verify expected 404/validation/SQL failures**

Run: `cd backend && node --test test/requestNotificationRoutes.test.js test/notFoundRoutes.test.js`

- [ ] **Step 3: Implement atomic first-view and exact recipient lookup**

Use `UPDATE requests ... WHERE inventory_viewed_at IS NULL RETURNING ...` inside
`withTransaction`, after locking the request and applying
`assertInventoryRequestMutation`. Resolve the sales user with:

```sql
SELECT u.id
FROM users u
JOIN requests r ON r.sales_rep_id = u.sales_rep_id
WHERE r.id = $1 AND u.role = 'sales_rep' AND u.is_active = true
ORDER BY u.id
LIMIT 1
```

Emit only when `RETURNING` produced the first transition.

- [ ] **Step 4: Implement transactional Not Found mutual exclusion and confirmation gating**

For a `not_found=true` row update, atomically set both found flags and their
timestamps to false/null. For a found=true update, atomically clear
`not_found`, `not_found_at`, and `not_found_by`. Apply the same update sets to
bulk actions. Before confirmation, load all rows and reject with
`Resolve every item with STN, CERT, or Not Found before confirming.` unless
`canConfirmResolution` succeeds.

- [ ] **Step 5: Add create/view/confirm notification emission and response mapping**

Creation emits `notification:request-created` to exactly
`creation.fulfillmentBranch`. View emits `notification:request-viewed` and
confirmation emits `notification:request-confirmed` to the requesting user ID.
Every payload includes a stable event ID based on transition and request ID.

- [ ] **Step 6: Run focused request tests and the backend suite**

Run: `cd backend && node --test test/requestNotificationRoutes.test.js test/notFoundRoutes.test.js && npm test`

- [ ] **Step 7: Commit backend transitions**

```bash
git add backend/src/routes/requests.js backend/test/requestNotificationRoutes.test.js backend/test/notFoundRoutes.test.js
git commit -m "feat(requests): notify lifecycle transitions"
```

### Task 4: Build the reusable temporary popup host

**Files:**
- Create: `frontend/src/lib/requestNotifications.ts`
- Create: `frontend/src/components/NotificationHost.tsx`
- Modify: `frontend/src/lib/socket.ts`
- Create: `frontend/scripts/request-notifications.test.ts`

**Interfaces:**
- Produces: `RequestNotification` discriminated union for created/viewed/confirmed events
- Produces: `notificationMessage(notification): { title: string; body: string; href: string }`
- Produces: `appendUniqueNotification(queue, incoming): RequestNotification[]`
- Extends: `useBranchSocket` subscriptions with all three notification events

- [ ] **Step 1: Write failing pure notification tests**

```ts
test('deduplicates repeated socket event IDs', () => {
  assert.equal(appendUniqueNotification([viewed], viewed).length, 1);
});

test('confirmed copy promises the next handoff without claiming shipment', () => {
  const copy = notificationMessage(confirmed);
  assert.match(copy.body, /receive it soon/i);
  assert.doesNotMatch(copy.body, /shipped/i);
});
```

Also test inventory preview copy and exact request query/hash navigation.

- [ ] **Step 2: Run the frontend notification test and verify imports fail**

Run: `cd frontend && npx tsx --test scripts/request-notifications.test.ts`

- [ ] **Step 3: Implement pure event formatting, deduplication, and socket subscriptions**

Use event names `notification:request-created`,
`notification:request-viewed`, and `notification:request-confirmed`. Preserve the
existing branch refresh callback API.

- [ ] **Step 4: Implement `NotificationHost` queue and accessible toast UI**

Mount one socket subscription in the host, remove each item after 10,000 ms,
render `role="status" aria-live="polite"`, expose a dismiss button, and navigate
on click with Next.js `useRouter`. Keep a session-lifetime `Set<string>` of
event IDs so React remounts do not repeat a popup.

- [ ] **Step 5: Run focused tests and frontend type/build checks**

Run: `cd frontend && npx tsx --test scripts/request-notifications.test.ts && npm run build`

- [ ] **Step 6: Commit the popup infrastructure**

```bash
git add frontend/src/lib/requestNotifications.ts frontend/src/components/NotificationHost.tsx frontend/src/lib/socket.ts frontend/scripts/request-notifications.test.ts
git commit -m "feat(ui): add request notification popups"
```

### Task 5: Wire inventory and sales request interfaces

**Files:**
- Modify: `frontend/src/app/dashboard/layout.tsx`
- Modify: `frontend/src/app/rep/layout.tsx`
- Modify: `frontend/src/app/dashboard/requests/page.tsx`
- Modify: `frontend/src/app/rep/my-requests/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/scripts/request-actions.test.js`
- Modify: `frontend/scripts/request-workflow.test.ts`

**Interfaces:**
- Adds: `api.markRequestViewed(id: number)`
- Extends: `RequestStone` with `not_found`, `not_found_at`, `not_found_by`
- Extends: request types with inventory-view and confirmation audit fields

- [ ] **Step 1: Write failing static and workflow tests**

Assert both authenticated layouts mount `NotificationHost`; `toggleExpand`
calls `api.markRequestViewed(id)` only after `api.requestDetail(id)` succeeds;
the resolution table displays `Not Found` and no `RET`; and My Requests renders
durable viewed/confirmed labels. Assert `Not Found` uses the ordinary
authorized resolution editability predicate rather than the old return-stage
predicate, so it is enabled on active requests.

- [ ] **Step 2: Run focused tests and verify the old UI fails assertions**

Run: `cd frontend && node --test scripts/request-actions.test.js && npx tsx --test scripts/request-workflow.test.ts`

- [ ] **Step 3: Extend API types and methods**

```ts
markRequestViewed: (id: number) =>
  request<ViewTransition>(`/api/requests/${id}/viewed`, { method: 'POST' })
```

Update the stone/check-all unions to
`'stone_found' | 'cert_found' | 'not_found' | 'returned'`, while the request
dashboard exposes only the first three during resolution.

- [ ] **Step 4: Mount popup hosts and wire first expansion**

Mount the inventory host with `user.branch` and role `inventory`, and the sales
host with `user.branch` and role `sales_rep`. After detail retrieval succeeds,
call `markRequestViewed`, store returned lifecycle fields, and do not call it on
collapse or page refresh.

- [ ] **Step 5: Replace RET controls and show durable sales lifecycle state**

Render `Not Found` at header and row level. Derive checkbox state from
`stone.not_found`. Disable confirmation until every row satisfies the same
scope-aware deliberate-resolution predicate used by the backend, while still
handling a backend 409. On sales cards show the persisted viewed and confirmed
timestamps as compact status text.

- [ ] **Step 6: Run focused frontend tests, full frontend tests, and build**

Run: `cd frontend && npm test && npm run build`

- [ ] **Step 7: Commit integrated request UI**

```bash
git add frontend/src/app/dashboard/layout.tsx frontend/src/app/rep/layout.tsx frontend/src/app/dashboard/requests/page.tsx frontend/src/app/rep/my-requests/page.tsx frontend/src/lib/api.ts frontend/scripts/request-actions.test.js frontend/scripts/request-workflow.test.ts
git commit -m "feat(requests): show lifecycle notifications"
```

### Task 6: Regression verification and handoff

**Files:**
- Modify only files needed to fix a test-proven regression

**Interfaces:**
- Consumes all preceding task interfaces; produces a verified release commit.

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
(cd backend && npm test)
(cd frontend && npm test && npm run build)
```

- [ ] **Step 2: Exercise local and cross-branch sessions**

Run the app with two authenticated browser sessions. Create one same-branch
request and one request fulfilled by another branch. Verify the inventory
preview, first expansion, exact sales popup, confirmation popup, persistent
labels, and negative controls for unrelated users and branches.

- [ ] **Step 3: Review the final diff and migration safety**

Run: `git diff origin/main...HEAD --check && git status --short`

Confirm no Graphify output, credentials, local databases, build output, or
temporary test artifacts are staged.

- [ ] **Step 4: Commit any test-proven corrections, then push**

```bash
git push origin HEAD
```
