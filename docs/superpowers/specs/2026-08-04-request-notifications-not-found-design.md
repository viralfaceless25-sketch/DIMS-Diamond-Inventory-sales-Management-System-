# Request Notifications and Explicit Not-Found Resolution Design

## Goal

Remove the manual coordination currently required after a sales request is
created. Inventory receives an immediate request preview, while the requesting
sales rep is told when inventory first views and then confirms the request.
Replace the misleading `RET` resolution control with an explicit `Not Found`
choice without changing the separate return lifecycle.

## Scope

This change covers:

- temporary in-app request popups for inventory and sales
- exact-user and exact-fulfillment-branch realtime routing
- durable viewed and confirmed lifecycle state on requests
- local and cross-branch request flows
- explicit per-row not-found resolution
- authorization, idempotency, reconnect behavior, and automated coverage

It does not add a notification inbox, email or SMS delivery, browser push
notifications, or offline replay of expired popups.

## Notification Experience

Notifications appear as clickable temporary popups for approximately ten
seconds. Multiple notifications queue rather than replacing each other. A
popup can be dismissed immediately and uses an accessible live region without
stealing keyboard focus.

When sales creates a request, the responsible fulfillment inventory branch
receives one popup containing:

- requesting sales rep name and home branch
- request number and request type
- requested row count
- a short preview of up to three requested barcodes, followed by a remaining
  count when needed

Selecting the popup opens the inventory Requests page and identifies or
expands the matching request.

When inventory first expands the request card and successfully loads its
details, the requesting sales rep receives one popup stating that inventory
viewed the request. Merely loading or refreshing the Requests page does not
count as a view.

When inventory confirms the resolution, the same sales rep receives one popup
stating that inventory confirmed the request and that they will receive it
soon. The popup may include compact found/not-found counts, but it must not
promise a shipment stage that has not occurred.

## Durable Lifecycle State

Temporary popups are not an inbox, but the underlying request state is durable.
Requests store the first inventory-view timestamp and actor, plus the existing
confirmation state with a confirmation timestamp and actor. The sales My
Requests card displays compact `Viewed by inventory` and `Confirmed by
inventory` states after the popups disappear or after a refresh.

The view transition is first-write-only. Concurrent expansions by multiple
authorized inventory users update one row atomically and produce at most one
sales notification. Confirmation is likewise emitted only for the transition
from unconfirmed to confirmed. Repeated requests, reconnects, and duplicate
socket delivery must not create duplicate lifecycle transitions.

## Realtime Routing

Authenticated sockets automatically join server-controlled rooms derived from
the authenticated identity:

- every user joins a room keyed by user ID
- inventory users join the inventory room for their assigned branch
- administrators receive inventory notifications only where existing branch
  authorization permits it

Clients cannot choose a different user or inventory-notification room.
Existing branch rooms continue to refresh shared request data, while the new
targeted rooms carry user-facing notifications.

Request-created notifications go only to the branch responsible for fulfilling
the request. Local requests therefore notify local inventory once. Cross-branch
requests notify source/fulfillment inventory once, not the sales branch merely
because that branch participates in delivery. Viewed and confirmed
notifications go only to the user account associated with the request's sales
rep; other sales users in the same branch must not receive them.

The server emits a display-safe payload rather than relying on every client to
refetch before showing a popup. Normal request refresh events remain separate
from notification events.

## Viewed Transition API

Expanding a request first retrieves its authorized details, then calls an
idempotent viewed transition endpoint. The backend permits this transition only
for inventory or administrators authorized to work the request at its current
fulfillment branch.

The endpoint returns the already-recorded state on repeated calls. It emits the
sales notification only when its atomic update records the first view. A failed
detail request, unauthorized expansion, collapsed card, or page preload cannot
mark a request viewed.

## Explicit Not-Found Resolution

The current `RET` checkbox is removed from the inventory resolution controls.
Its underlying `returned` data and return workflow remain intact because a
later return is not the same event as inventory failing to find a requested
item.

Each request row receives a dedicated `not_found` resolution field with audit
metadata. Its UI label is `Not Found`. It is a normal enabled checkbox whenever
the authenticated inventory branch may resolve that active request; it must not
inherit the permanently greyed or return-stage-only behavior of the old `RET`
control.

Resolution rules are:

1. Selecting `Not Found` clears `STN` and `CERT` for that row.
2. Selecting either `STN` or `CERT` clears `Not Found`.
3. Only controls applicable to the request scope are editable.
4. A row is deliberately resolved when it is marked `Not Found` or at least
   one applicable found control is selected.
5. For a combined stone-and-certificate request, `STN` only or `CERT` only is a
   valid partial result; `Not Found` means neither requested component was
   found.
6. Inventory cannot confirm while any row has no deliberate resolution.
7. The backend enforces the same mutual-exclusion and completion rules in a
   transaction; client behavior alone is not trusted.

Bulk checkbox actions follow the same rules. Selecting all `Not Found` clears
all applicable found flags. Selecting all `STN` or `CERT` clears `Not Found`
only on affected rows. Existing authorization and immutable terminal-state
rules continue to apply.

## Schema and Compatibility

The request record gains nullable first-view and confirmation audit fields.
Request-stone rows gain a not-found flag and audit fields. Migrations use safe
defaults so existing requests remain readable.

Existing confirmed requests are treated as confirmed even if their historical
confirmation timestamp is absent. Active legacy rows that have STN or CERT
selected are already deliberately resolved. Other active legacy rows require
an explicit `Not Found` or found selection before a new confirmation attempt.
No migration rewrites `returned` values.

## Failure and Reconnect Behavior

- A successful database transition is authoritative even if socket delivery
  fails; the durable card state appears on the next refresh.
- A popup is shown once per event ID during a mounted client session, guarding
  against duplicate socket delivery and React remount behavior.
- A disconnected user does not receive an old temporary popup on reconnect,
  but sees the durable request lifecycle state.
- Notification failures never roll back successful request creation, viewing,
  or confirmation.
- Stale or conflicting resolution updates return a useful error and refresh the
  affected request.

## Testing and Acceptance Criteria

Automated tests must prove:

- local sales creation notifies only local fulfillment inventory
- cross-branch creation notifies only source/fulfillment inventory
- the inventory popup identifies the requester and contains the correct preview
- page load does not mark viewed; the first authorized expansion does
- repeated or concurrent expansions emit exactly one viewed transition
- only the requesting sales user receives viewed and confirmed notifications
- confirmation emits once and its message says the request will arrive soon
- reconnect and duplicate events do not produce duplicate visible popups
- durable viewed/confirmed states survive refresh and missed popups
- `Not Found` and STN/CERT remain mutually exclusive in both UI and API
- `Not Found` is enabled for authorized active resolution, persists through the
  backend, and remains selected after refresh
- row-level and bulk `Not Found` controls both perform real backend mutations
- partial STN/CERT results remain valid for combined requests
- unresolved rows cannot be confirmed
- `returned` data and the existing return workflow remain unchanged
- unauthorized branches and roles cannot view-transition or resolve requests

Verification includes focused backend and frontend tests, the complete existing
test suites, a production frontend build, and a manual two-session exercise for
both a local request and a cross-branch request. A successful implementation is
one where the correct users see the correct popup without refreshing and the
same lifecycle state remains accurate after both sessions refresh.
