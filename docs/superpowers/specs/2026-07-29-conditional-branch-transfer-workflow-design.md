# Conditional Branch-Transfer Request Workflow Design

## Goal

Make the request panel change automatically according to the selected stone's
ERP home branch, support every required local and branch-transfer fulfillment
choice, let sales reps finish customer-shipment paperwork and labels later from
My Requests, and close the integrity and dependency flaws found during the
whole-system audit.

## Confirmed business rules

- The uploaded stock list remains authoritative for a stone's home branch and
  stock status.
- One request may contain only stones from one home branch.
- Only `available` stock is requestable. On Memo, On Hold, and In Transit remain
  visible but blocked.
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
   customer after ERP BT confirmation, paperwork upload, and label upload.
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

## Paperwork and shipping-label workflow

Customer shipment requests created after this release use workflow version 2.
They begin with:

- paperwork: pending;
- shipping label: pending.

For a cross-branch customer shipment, the source inventory must first confirm
that the external Maitri ERP branch transfer was completed. My Requests then
enables the following ordered steps:

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

- cross-branch paperwork before ERP BT confirmation: `409`;
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
- ERP BT status when applicable;
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
- ERP BT confirmation;
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
explicitly store version `2`.

Existing active customer shipments keep their current paperwork-decision and
label rules so deployment cannot strand an in-progress request. They may use
the new upload interface, but an actual paperwork file is mandatory only for
version-2 requests. New requests always use the stricter workflow.

The migration is additive and idempotent. It does not delete or rewrite stock,
requests, tracking events, or users.

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
- paperwork cannot precede cross-branch ERP BT confirmation;
- label cannot precede paperwork;
- version-2 shipment cannot complete without both real files;
- document ownership, inventory branch access, file size, and file signatures;
- local inventory mutation is branch-scoped;
- cross-branch holder lookup uses the supplying branch;
- simultaneous duplicate submission is serialized and rejected;
- invoice results work across branches and remain grouped by home branch;
- legacy workflow-version-1 requests remain actionable;
- dependency audits contain zero known vulnerabilities;
- backend, frontend, desktop, Rust, and installer tests/builds pass.

After deployment, live smoke checks cover API health, database readiness,
authentication rejection, request-page assets, release metadata, and the
public installer checksum. A reversible test request may be used only if a
dedicated non-production test account and stock item are available; production
inventory data is not altered merely to prove deployment.
