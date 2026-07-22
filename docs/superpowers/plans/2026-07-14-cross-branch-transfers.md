# Cross-Branch Transfers Implementation Plan

**Goal:** Let a sales rep request stock from another branch while enforcing the correct source-branch shipping, destination receiving, customer delivery, paperwork, and label rules.

**Architecture:** Keep a request's existing `branch` as the requesting rep's home branch. Add an optional cross-branch route on `requests` with a source branch, delivery route, paperwork choice, and guarded lifecycle. Store one optional shipping label per request in the database so it is available to all authorized branches.

## Safety Rules

- Sales reps can create only requests for their own account and cannot choose a stock branch that does not contain every requested barcode.
- A request batch can have only one supplying branch.
- Only source-branch inventory can pack, ship, or drop off; only destination-branch inventory can receive, ready, or hand an internal transfer to the rep.
- A direct customer shipment cannot be marked shipped until a valid label is uploaded.
- Sales reps can upload labels only on their own awaiting or packed customer-shipment requests.
- Every status change and label upload is audited and announced to the relevant branch rooms.

## Implementation Tasks

1. Add idempotent schema columns and indexes for cross-branch request routing and a one-label table.
2. Extend request creation validation to resolve stock against the declared supplying branch and create a cross-branch route atomically.
3. Add transfer-status and shipping-label endpoints with role, branch, sequence, file type, and file size enforcement.
4. Extend typed API contracts and sales UI to select supplying branch, transfer/customer route, paperwork, and a later label upload.
5. Extend inventory request cards with source/destination route and controlled transfer actions, grouped by branch pair.
6. Run migration, backend syntax checks, frontend production build, and live request-flow smoke tests.
