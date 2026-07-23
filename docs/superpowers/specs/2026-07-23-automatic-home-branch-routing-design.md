# Automatic Home-Branch Routing Design

## Goal

Make every stone request route automatically to the inventory team at the
stone's current home branch, while preserving ERP-owned stock statuses and
making cross-branch ERP transfers quick and auditable.

## Source of truth

The uploaded Maitri ERP workbook remains authoritative for:

- barcode
- branch
- stock status

The application must not offer manual stock-status overrides. A later ERP API
integration can replace the upload without changing the application's canonical
status model.

## Canonical statuses

The backend normalizes source values to:

- `available`
- `on_memo`
- `on_hold`
- `in_transit`

`Available`, `In Stock`, and `InStock` all map to `available`. `On Memo`,
`OnMemo`, `On Hold`, `OnHold`, `In Transit`, and `InTransit` map to their
canonical values. Only `available` is requestable.

The current workbook does not contain in-transit rows, but the status remains
supported in import normalization, API responses, filters, badges, and blocked
request messages so a future ERP API can supply it without a schema redesign.

## Sales-rep request flow

The manual route controls (`NY local`, `NY-LA`, `LA-CH`, and the other explicit
branch pairs) are removed.

The rep browses all stock. The first stone added to a request establishes the
request's home branch from the inventory record. Additional stones must have
the same home branch; otherwise the rep is told to submit the current request
first. This preserves one source package, one shipping label, and one ERP branch
transfer per request.

The rep chooses only:

- Ship to my branch
- Ship directly to customer
- Sales rep drop-off

The destination branch is always the authenticated rep's branch. The backend
looks up the rep branch and every requested barcode again and derives the
source/home branch itself. Client-supplied source or destination branches are
not trusted.

For a same-branch request, the first choice is displayed as stockroom pickup.
For a cross-branch request, it is displayed as shipping to the rep's branch.
Direct-customer shipping retains paperwork and shipping-label requirements.
Drop-off retains company and address requirements.

## Cross-branch ERP transfer

Every cross-branch request starts with an `ERP branch transfer required` state.
The supplying branch inventory team sees:

- source and destination branches
- a one-click Copy Barcode action for every requested stone
- an `ERP branch transfer completed` confirmation action

Only inventory assigned to the supplying branch may confirm the ERP transfer.
Confirmation is timestamped, attributed to the user, audited, and broadcast in
real time. A cross-branch request cannot be marked packed until this confirmation
exists.

No direct Maitri ERP write is attempted because ERP API access is not available.
The app supplies the barcode-copy workflow and records that the external ERP
transfer was completed.

## Remote delivery

The Windows executable is a secure Tauri shell that loads the hosted frontend.
Deploying the frontend and backend updates all existing installations on their
next load without reinstalling the EXE and without an updater service fee.

A version 1.0.3 installer is still produced for new installations and the public
download page. Native-shell changes in a future release would require users of
1.0.2 to install a newer shell once; this feature does not require native-shell
changes.

## Stone movement tracking

The tracking upgrade follows the useful information architecture in the ERP
reference without attempting to duplicate the ERP interface or claim access to
ERP-only history.

The app records its own stone movements from request creation onward:

- requested
- ERP branch transfer recorded
- packed at source
- branch transfer sent
- branch transfer received
- ready for sales rep
- stone/certificate confirmed
- handed to sales rep
- shipped to customer
- dropped off to customer
- returned

Each event stores the barcode, request, timestamp, actor, source branch,
destination branch, movement type, and relevant details. Existing request
timestamps remain visible as a best-effort starting history; events recorded
after this release provide the complete chronological audit trail.

Inventory receives a movement-history page with barcode/certificate search,
branch and movement filters, a current-stone summary, and an expandable
chronological timeline. Sales reps receive a simplified Stone Tracking page
restricted server-side to stones on their own requests. Reps cannot access
other reps' movement data by changing a URL or request parameter.

## Verification

Automated tests cover:

- every canonical status alias and requestability
- home-branch derivation and mixed-branch rejection
- automatic route derivation
- ERP confirmation required before packing
- frontend fulfillment labels and blocked-status text
- removal of explicit branch-pair controls
- presence of barcode-copy and ERP-confirmation actions
- movement-event recording and sales-rep scoping
- inventory and rep tracking views
- release version and download metadata

Backend, frontend, Rust, and installer builds must pass before deployment.
