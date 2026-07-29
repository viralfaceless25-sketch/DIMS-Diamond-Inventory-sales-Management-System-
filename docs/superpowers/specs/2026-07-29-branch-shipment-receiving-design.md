# Branch Shipment Receiving Design

## Outcome

Add a simple, branch-scoped **Receive Shipments** workflow for NY, LA, and
CH inventory. Destination inventory scans every physical stone/certificate
arrival, records what was actually inside the package, sees the requesting
sales rep immediately, and records the eventual handoff. Receipt history is
stored by the receiving branch's local date and can be exported to Excel.

This release also corrects request ownership:

- the stone's stored home branch is the supplying/source branch;
- only source inventory resolves the requested Stone/Cert items and performs
  source-side fulfillment actions;
- destination inventory does not resolve the source request;
- destination inventory uses **Receive Shipments** for physical arrivals;
- Maitri ERP digital BT issue/receipt stays independent of physical receiving.

## Approved Business Rules

1. Stone and certificate use the same barcode.
2. Each receipt explicitly records **Stone: Yes/No** and **Cert: Yes/No**.
3. At least one of Stone or Cert must be Yes for a receipt entry.
4. Stone and Cert may arrive on separate dates. Each arrival remains a
   separate dated record, while the request roll-up combines all Yes values.
5. A barcode with no active matching request must still be saved as
   **Unmatched - Needs Review**.
6. A repeated receipt produces a warning. Inventory may deliberately override
   the warning for a genuine additional package; the override is audited.
7. All scans are grouped automatically by receiving-branch local date. There
   is no manual create-day or close-day step.
8. Inventory records **Handed to [Sales Rep]** after giving the received
   contents to the requester. The acting inventory user and time are stored.
9. A physical scan never confirms Maitri ERP BT receipt.
10. Stale Excel data or an out-of-order internal workflow status never causes
    a physical arrival to be discarded. The receipt is saved and any mismatch
    is clearly flagged.

## Workflow Boundaries

### Source/home branch request workflow

The request appears in the supplying branch's request queue. Source inventory
finds/scans the requested Stone/Cert, confirms the resolution, performs the
Maitri ERP BT issue when required, packs, and ships.

For an NY stone requested by an LA sales rep:

- NY inventory resolves and ships the request;
- LA inventory cannot change NY's source-resolution checkboxes;
- LA inventory receives the physical shipment and hands it to the LA rep.

### Destination physical receiving workflow

Only branch-to-branch office shipments destined for the logged-in inventory
branch are eligible for automatic request matching. Direct customer shipment
and customer drop-off routes do not enter a destination inventory receiving
queue.

Scanning an arrival is authoritative for the physical receipt log. When all
requested components have arrived, the internal physical workflow becomes
ready for the sales rep. A stale internal status is retained in the audit
details as a workflow mismatch, but it does not erase or reject the scan.

### Maitri ERP workflow

Maitri ERP BT issue and BT receipt remain explicit, manual confirmations in
this application until real ERP API access exists. The receiving screen may
display their current state, but a physical scan does not change either one.

## Inventory User Interface

Add **Receive Shipments** to the inventory sidebar. The authenticated
inventory profile fixes the receiving branch; the user cannot receive for a
different branch from this screen.

The page has three intentionally small areas:

1. **Scan arrival**
   - always-focused barcode input compatible with keyboard-wedge scanners;
   - manual entry fallback;
   - matched request card showing barcode, source branch, request number,
     requesting sales rep, expected contents, route, and ERP BT state;
   - large Stone Yes/No and Certificate Yes/No controls;
   - source-branch selector only when no request can be matched;
   - save button and clear success/error feedback.
2. **Today's receipts**
   - columns: time, barcode, Stone, Cert, From, Request, Give to, Status,
     and Action;
   - green = ready for rep, amber = partial, red = unmatched/review, grey =
     handed over;
   - a single **Handed to [name]** action when the request is physically
     complete.
3. **History**
   - branch-local date selector, previous/next date controls, search, source
     and status filters;
   - one-click Excel export using the selected date and current branch.

The existing Requests page keeps source-fulfillment controls. Destination
receiving controls and scanner behavior are removed from that page so users
never have to reason about disabled source checkboxes.

## Matching Rules

Lookup is restricted to the logged-in receiving branch and normalized exact
barcode. Eligible requests are active internal-transfer requests whose
delivery branch is the receiving branch.

- Exactly one candidate: match automatically.
- No candidate: show unmatched state and require the sending branch.
- Multiple candidates: show a compact candidate picker; never guess.

An unmatched receipt may later be linked to an eligible request by inventory
or an administrator. Linking is audited and recomputes the request's receipt
roll-up.

Request completeness is component-specific:

- `stone_only`: at least one matched Stone=Yes receipt for every request row;
- `cert_only`: at least one matched Cert=Yes receipt for every request row;
- `stone_and_cert`: both conditions for every request row, potentially across
  different receipt records and dates.

A No value means only "not present in this arrival." It never cancels the
request or prevents a later Yes receipt.

## Data Model

Create an idempotent `shipment_receipts` table:

- immutable primary key;
- receiving branch and source branch;
- normalized barcode;
- nullable request and request-stone links for unmatched receipts;
- Stone/Cert received booleans;
- match state (`matched` or `unmatched`);
- branch-local `received_on` date and exact UTC `received_at`;
- receiving user;
- duplicate-override flag;
- optional workflow-mismatch details and bounded note;
- correction timestamps/user when a same-day mistake is corrected.

Create indexes for:

- receiving branch plus local date;
- normalized barcode;
- request/request-stone roll-up;
- unmatched review queue.

Existing request Stone/Cert fields continue to represent source resolution;
they are not reused for destination physical receipt state.

All writes run inside database transactions. Receipt creation locks the
selected request and request-stone rows, rechecks branch authorization and
matching, records audit/movement events, and computes physical readiness.

## API

Add authenticated inventory endpoints under `/api/receipts`:

- `GET /lookup?barcode=...` returns eligible candidates and duplicate context
  for the logged-in branch;
- `POST /` records one arrival after server-side validation and returns the
  saved row plus request roll-up;
- `GET /?date=...&search=...&sourceBranch=...&status=...` returns the branch's
  dated receipt history;
- `PATCH /:id` corrects Stone/Cert/source data with an audit record;
- `PATCH /:id/link` links an unmatched receipt to one eligible request stone;
- `POST /requests/:requestId/handoff` records handoff only when every expected
  component has physically arrived;
- `GET /export?date=...` returns a dated `.xlsx` file.

The API derives the inventory branch from the authenticated user. Client
supplied receiving branches are never trusted.

## Dates and Export

Store exact timestamps in UTC. Derive `received_on` on the server using:

- NY: `America/New_York`;
- LA: `America/Los_Angeles`;
- CH: `America/Chicago`.

Excel export uses the familiar columns from the current workbook—Barcode,
Stone, Cert, and Location—and adds Time, Request #, Sales Rep, Status, and
Received By. Each export contains one selected branch-local date and does not
modify database records.

## Safety and Error Handling

- Reject empty/oversized/invalid barcodes and invalid branch identifiers.
- Require at least one received component.
- Enforce inventory role and authenticated branch on every endpoint.
- Warn before duplicate component receipt and require an explicit override.
- Never discard an unmatched or out-of-order physical receipt.
- Never expose password hashes, secrets, or unrestricted cross-branch data.
- Record receipt, correction, link, mismatch, and handoff actions in
  `audit_log`.
- Broadcast branch-scoped socket events after successful commits so all open
  dashboards refresh.

## Release and Remote Update

The hosted frontend/backend update is release **1.0.5**. Existing installed
desktop clients load the hosted application, so they receive this feature on
their next open or refresh without downloading a new installer.

Also build and publish a new optional
`DiamondInventory-Setup-1.0.5.exe` for new computers. The versioned installer,
public release metadata, byte size, and SHA-256 must agree. The desktop shell
remains a GUI process with no terminal and grants no privileged Tauri
capabilities to remote content.

The Render schema migration is idempotent and preserves existing users,
branches, stock, requests, files, audit history, and movement history.

## Acceptance Criteria

1. NY, LA, and CH inventory each see Receive Shipments scoped to their own
   branch.
2. A matched scan identifies the correct request and local requesting rep.
3. Stone/Cert partial arrivals can be recorded on different dates.
4. Unmatched arrivals are saved and reviewable.
5. Duplicate receipts warn and require an audited override.
6. Daily history and Excel export reflect the receiving branch's local date.
7. Completed receipts can be handed to the requesting rep with actor/time.
8. Physical scans do not change Maitri ERP BT receipt.
9. Source inventory—not destination inventory—can resolve the request items.
10. Existing request, tracking, stock upload, authentication, and document
    workflows continue to pass regression tests.
11. Backend, frontend, desktop Node, Rust, production builds, migration
    smoke tests, and live API/web checks pass.
12. The public 1.0.5 installer matches its published SHA-256.
13. A complete source/handoff ZIP documents setup, deployment, URLs, release
    artifacts, tests, and operational workflow without containing secrets.
