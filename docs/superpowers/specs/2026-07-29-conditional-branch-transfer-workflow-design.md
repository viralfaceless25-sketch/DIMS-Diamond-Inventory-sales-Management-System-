# Conditional Branch-Transfer Request Workflow Design

## Goal

Make the request panel change automatically according to the selected stone's
ERP home branch, support every required local and branch-transfer fulfillment
choice, let sales reps finish customer-shipment paperwork and labels later from
My Requests, and close the integrity and dependency flaws found during the
whole-system audit.

## Confirmed business rules

- The uploaded stock list is authoritative only for the ERP snapshot captured
  when that file was generated. It is not treated as live ERP state.
- One request may contain only stones from one home branch.
- Only `available` stock is requestable. On Memo, On Hold, and In Transit remain
  visible but blocked.
- An In Transit stone may be stale or absent in the once-daily file. Live
  request cards therefore track manually confirmed ERP BT events separately
  from the uploaded snapshot.
- ERP digital movement and physical stone movement are independent timelines.
  Receiving a BT in ERP does not prove that the physical stone arrived.
- The default branch-transfer destination is the authenticated sales rep's
  branch. The label displays the actual branch, such as
  `BT ship stone/cert to my branch (NY)`.
- Stone + cert, stone only, and cert only remain available for every fulfillment
  choice.
- Source, requesting-rep, and destination branches are validated and derived
  again by the backend. The browser is never trusted to assign the supplying
  branch.

## Approaches considered

### Selected: extend the existing server-enforced request workflow

The frontend shows conditional choices, while the backend independently
validates the choice against the authenticated rep and current stock rows. The
existing request, transfer, movement, audit, and realtime systems remain the
single source of workflow state. A small paperwork-file table and a workflow
version are added.

This approach preserves current data and tracking, minimizes migration risk,
and prevents a modified browser from bypassing branch or document rules.

### Rejected: conditional frontend labels only

Changing only the panel would be faster, but callers could submit a local
choice for cross-branch stock, select an unauthorized source branch, or skip
required documents by calling the API directly.

### Rejected: a second branch-transfer subsystem

Separate BT requests and tables would duplicate status, movement, permissions,
and realtime logic. Inventory would have two queues for the same physical work,
and reporting could disagree.

## Conditional request panel

Before a stone is selected, the panel explains that selecting a stone will
determine the available fulfillment choices. The first selected stone fixes the
request home branch. Selecting a stone from another home branch is rejected
with an instruction to submit the current request first.

### Stone home branch equals the rep branch

The panel shows exactly these local choices:

1. **Urgent** — a priority local inventory request.
2. **Drop-off** — local inventory delivers to a customer; a drop-off address is
   required and company name is optional.
3. **Shipment** — local inventory ships to a customer. Paperwork and label use
   the deferred My Requests workflow.
4. **Local** — normal local inventory handling/pickup.

The stored request types are `urgent`, `dropoff`, `ship`, and `local`
respectively. Shipment maps to `customer_ship`; drop-off maps to
`customer_dropoff`; urgent and local do not create a transfer route.

### Stone home branch differs from the rep branch

The panel shows exactly these branch-transfer choices:

1. **BT ship stone/cert to my branch (REP_BRANCH)** — destination is always the
   authenticated rep's branch.
2. **BT ship stone/cert to customer** — source inventory ships directly to the
   customer after source ERP BT issue, destination ERP BT receipt, paperwork
   upload, and label upload.
3. **BT drop-off to customer** — source inventory drops off directly; a
   drop-off address is required and company name is optional.
4. **BT ship to another branch** — the rep chooses NY, LA, or CH. The stone's
   current home branch is disabled because it is not a transfer destination.

For option 4, the backend accepts only an existing branch ID and rejects the
stone's home branch as the destination. Choosing the rep's own branch is valid
and produces the same stored physical route as option 1.

## API request contract

The browser sends one `fulfillmentChoice` value:

- `local_urgent`
- `local_dropoff`
- `local_ship`
- `local`
- `bt_to_rep_branch`
- `bt_customer_ship`
- `bt_customer_dropoff`
- `bt_to_branch`

It also sends the existing `requestScope`, optional `dropoffAddress`, optional
`dropoffCompany`, and `deliveryBranch` only for `bt_to_branch`.

The backend:

1. authenticates the sales rep and loads the rep branch;
2. normalizes a maximum of 50 unique barcode/item pairs;
3. locks the selected stock rows in deterministic order;
4. verifies each row still exists and is requestable;
5. derives one home branch and rejects mixed-home-branch requests;
6. validates that the fulfillment choice belongs to the local or BT choice set
   appropriate for the derived home branch;
7. derives request type, route, source branch, and destination branch;
8. rechecks active holders inside the same transaction;
9. inserts the request, stones, and initial movement atomically.

Barcodes longer than 64 characters and requests over 50 unique items are
rejected before database work. Locking and rechecking inside the transaction
prevents two simultaneous submissions from both acquiring the same stone.

## Parallel ERP and physical movement

Every cross-branch request shows two timelines instead of overloading one
status.

### ERP digital movement

1. **BT issue requested** — source inventory receives the request and can copy
   each barcode into Maitri ERP.
2. **BT issued in ERP** — source inventory confirms the external ERP action.
   The request app records the actor and timestamp; it does not pretend the
   daily spreadsheet supplied this event.
3. **BT receive requested** — for an office transfer, the sales rep may ask
   destination inventory to make the stone digitally available when invoice or
   memo paperwork is needed. Customer-direct routes surface this task
   automatically after BT issue.
4. **BT received in ERP** — destination inventory confirms the external ERP
   Receive Branch Transfer action. This can occur without physical arrival,
   including when LA keeps the physical stone and ships it to an NY customer's
   address.

The existing `erp_transfer_confirmed` fields retain their data but are labeled
as ERP BT **issued**. Additive fields record ERP BT **received** and the rep's
receive request. Only source inventory may confirm issue; only destination
inventory may confirm receipt; receipt cannot precede issue.

### Physical movement

The existing transfer states remain physical events:

- office/branch route: packed, shipped, physically received, ready for rep,
  handed to rep;
- customer shipment: packed, shipped to customer;
- customer drop-off: packed, dropped off.

After ERP BT issue, physical movement does not wait for ERP BT receipt. For a
normal LA-to-NY office request, the stone may arrive and be handed to the rep
before NY receives the BT in ERP. For direct-to-customer shipment, ERP BT
receipt and paperwork must finish before the source branch can ship.

Every movement is timestamped, attributed, and shown under the correct
timeline. No Excel value can silently advance or reverse either timeline.

## Daily ERP snapshot preservation and reconciliation

Stock uploads become snapshot replacements without destructive row deletion:

- each loose and jewelry row stores `snapshot_active`, `last_seen_at`, and
  `snapshot_missing_since`;
- before importing an included branch, existing rows for that branch are marked
  inactive instead of deleted;
- rows present in the file are upserted, moved to the file's branch when
  required, marked active, and given a new last-seen timestamp;
- stock search and request creation use only active snapshot rows;
- an inactive row is not requestable and invoice review reports
  `Not in latest ERP snapshot`;
- archived row details remain available to request tracking and history.

A missing row is never automatically called In Transit. If an active request
has a manually confirmed ERP BT issue, the request card can show the live
operational status `BT issued / ERP in transit` while separately showing that
the latest snapshot is stale or missing. A missing row without that confirmed
event remains simply absent from the latest snapshot.

When a later upload shows the barcode at the destination branch, the request
card displays the snapshot as reconciled. A newer snapshot that contradicts
the manually confirmed request state is flagged for inventory review rather
than overwriting either record.

## Paperwork and shipping-label workflow

Customer shipment requests created after this release use workflow version 2.
They begin with:

- paperwork: pending;
- shipping label: pending.

For a cross-branch customer shipment, source inventory must confirm ERP BT issue
and destination inventory must confirm ERP BT receipt. Only then can the sales
rep create the invoice or memo in ERP and use these ordered My Requests steps:

1. **Upload paperwork** — choose Invoice or Memo and upload one real PDF, PNG,
   or JPEG.
2. **Upload shipping label** — enabled only after paperwork exists.

For a local customer shipment, Step 1 is available immediately because no ERP
BT is required. Both steps remain editable until the request is shipped.

`request_paperwork_files` stores one current file per request with:

- request ID;
- paperwork type (`invoice` or `memo`);
- sanitized original filename;
- verified MIME type;
- binary file data;
- uploader;
- upload timestamp.

Paperwork and labels are limited to 10 MB, checked by file signature rather than
extension alone, rate-limited per user, and replace the previous file instead
of accumulating versions. Filenames used in response headers strip control
characters, slashes, backslashes, and quotes.

The request owner may upload and view both documents. Inventory may view them
only when assigned to the supplying or destination branch. Source inventory
gets one-click **Open paperwork** and **Open shipping label** actions for
downloading and printing. A version-2 customer shipment cannot be marked
shipped until both files exist.

The sequence is enforced by the backend:

- cross-branch paperwork before destination ERP BT receipt: `409`;
- label before paperwork: `409`;
- wrong route, wrong owner, or unrelated inventory branch: `403` or `400`;
- wrong file signature: `415`;
- oversized file: `413`;
- document replacement after shipment: `409`.

## My Requests experience

Each request shows:

- source and destination;
- selected local/BT fulfillment label;
- requested scope;
- transfer status;
- separate ERP BT issued/received status when applicable;
- latest ERP snapshot status and reconciliation warning when applicable;
- Step 1 paperwork status;
- Step 2 label status;
- drop-off address when applicable.

The paperwork and label actions are displayed only for customer shipment
requests. Step 2 is visibly disabled until Step 1 is complete. Successful
uploads refresh the card immediately through the API and existing realtime
events. Errors remain on the card instead of clearing the request or losing the
selected file.

## Inventory experience

Inventory continues to receive the request automatically at the stone's home
branch. The expanded request shows:

- source and destination branches;
- one-click Copy barcode for every item;
- requested stone/cert scope;
- source ERP BT issue and destination ERP BT receipt actions;
- a visible sales-rep request for ERP BT receipt;
- a separate physical-movement timeline;
- drop-off address;
- document readiness;
- Open paperwork and Open shipping label;
- only the next branch-authorized movement action.

Local request mutations are restricted to inventory assigned to that local
branch. Cross-branch actions remain split between source and destination
inventory. Viewing all queues may remain available, but viewing does not grant
mutation authority.

## Invoice-upload correction

PDF extraction checks inventory across all branches rather than only the sales
rep's branch. Available results are grouped by their ERP home branch. The
review screen provides an Add-to-cart action per home-branch group; it no longer
sends a mixed-branch batch directly. The rep then uses the same conditional
request panel as a manually selected stone.

On Memo, On Hold, In Transit, unknown, and missing stones remain unavailable
with their exact reason.

## Audit corrections included

### Supplying-branch availability

Active-holder queries filter by
`COALESCE(requests.fulfillment_branch, requests.branch)`, not the requesting
rep's branch. This makes cross-branch stones appear requested at their actual
home branch and blocks duplicate submissions correctly.

### Concurrent duplicate protection

Stock-row locks and the in-transaction active-holder recheck close the race
between two reps submitting the same stone at the same time.

### Inventory branch authorization

Local stone confirmation and resolution actions require the inventory user's
branch to equal the request's fulfillment branch. Cross-branch transfer actions
keep their source/destination checks.

### Dependency advisory

ExcelJS remains the low-memory streaming XLSX reader. Its legacy transitive
write/archive dependencies are pinned to `archiver` 8.0.0 and `unzipper`
0.12.5, which use the patched current minimatch/brace-expansion chain. The
stock parser read test, XLSX writer fixture test, full backend suite, and
`npm audit --omit=dev` must all pass before deployment.

## Backward compatibility

`requests.workflow_version` defaults to `1` for existing rows. New requests
explicitly store version `2`. Existing `erp_transfer_confirmed` data is
preserved and presented as BT issued; new received/requested fields default to
false.

Existing active customer shipments keep their current paperwork-decision and
label rules so deployment cannot strand an in-progress request. They may use
the new upload interface, but an actual paperwork file is mandatory only for
version-2 requests. New requests always use the stricter workflow.

The migration is additive and idempotent. The importer stops deleting missing
stock rows and archives them instead. It does not delete or rewrite requests,
tracking events, or users.

## Release and remote update

The hosted application release becomes 1.0.4. The backend migration runs during
normal Render startup, followed by the backend and static frontend deployment.

Existing Windows installations load the hosted frontend and therefore receive
the workflow update on next open or refresh without reinstalling. A 1.0.4
installer is also built, verified, published on the download page, and retained
for new computers.

## Verification

Automated coverage must prove:

- all four local choices appear only for same-branch stock;
- all four BT choices appear only for other-branch stock;
- default BT destination equals the authenticated rep branch;
- selected BT branch accepts NY/LA/CH and rejects the source branch;
- every route supports stone + cert, stone only, and cert only;
- drop-off address is mandatory;
- only source inventory can confirm ERP BT issued;
- only destination inventory can confirm ERP BT received;
- ERP BT receipt cannot precede issue;
- physical office movement can proceed independently of ERP BT receipt;
- paperwork cannot precede cross-branch ERP BT receipt;
- label cannot precede paperwork;
- version-2 shipment cannot complete without both real files;
- document ownership, inventory branch access, file size, and file signatures;
- local inventory mutation is branch-scoped;
- cross-branch holder lookup uses the supplying branch;
- simultaneous duplicate submission is serialized and rejected;
- invoice results work across branches and remain grouped by home branch;
- missing snapshot rows are archived, hidden from stock search, and blocked
  from requests without losing movement-history metadata;
- manual ERP and physical states remain separate from stale Excel data;
- later snapshots reconcile or flag, but never overwrite, manual events;
- legacy workflow-version-1 requests remain actionable;
- dependency audits contain zero known vulnerabilities;
- backend, frontend, desktop, Rust, and installer tests/builds pass.

After deployment, live smoke checks cover API health, database readiness,
authentication rejection, request-page assets, release metadata, and the
public installer checksum. A reversible test request may be used only if a
dedicated non-production test account and stock item are available; production
inventory data is not altered merely to prove deployment.
