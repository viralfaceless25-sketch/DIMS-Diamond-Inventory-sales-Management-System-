# Simple Inventory Request Flow Design

## Goal

Make the inventory request workflow easy to operate without weakening branch
permissions. Create dedicated Los Angeles and Chicago inventory accounts, fix
the disabled STN/CERT controls, and reduce each request to one clear current
task.

## Scope

This change covers:

- `stockla@maitri.nyc`, assigned to inventory role and branch `LA`
- `stockch@maitri.nyc`, assigned to inventory role and branch `CH`
- separate strong temporary passwords with a forced password change at first
  login
- cross-branch STN/CERT verification
- packing, shipping, receiving, and handoff action ordering
- recovery of active transfers created before this fix, including request
  `#1031`
- a focused audit of request-state controls for unreachable or contradictory
  states

It does not add another ERP integration, duplicate source/destination
checkboxes, or new fulfillment options.

## Simplicity Rules

1. Show one primary next action for the logged-in inventory branch.
2. Show checkboxes only when that branch is allowed to use them.
3. Explain a blocked step in one short sentence instead of showing a disabled
   cluster of unrelated controls.
4. Keep Maitri ERP digital BT state separate from physical movement.
5. Enforce every UI permission again in the backend.

## Account Design

Both new users use the existing `inventory` role and the same dashboard as NY
inventory. Their staff profiles bind them to their exact branches:

| Account | Role | Branch | Display name |
| --- | --- | --- | --- |
| `stockla@maitri.nyc` | inventory | LA | Inventory LA |
| `stockch@maitri.nyc` | inventory | CH | Inventory CH |

Each account receives a different generated temporary password. The account is
active immediately, but the first successful login redirects the user to create
a private permanent password.

## Request Workflow

For an NY stone requested by an LA sales rep:

1. The request routes automatically to NY inventory.
2. NY completes or rejects the Maitri ERP branch transfer.
3. NY checks the requested stone and/or certificate.
4. NY confirms the result.
5. Only then can NY mark the request packed and shipped.
6. LA marks the physical shipment received and ready for the sales rep.
7. LA records handoff to the sales rep.

The same flow applies to every branch combination; branch names are data, not
separate workflow implementations.

## Existing-Request Recovery

Old active requests may already be `packed` or `shipped_to_destination` without
source verification because the old UI allowed shipping first. For these
requests only:

- supplying inventory can still record the missing STN/CERT verification while
  the transfer is `packed` or `shipped_to_destination`
- the original transfer status and movement history remain unchanged
- destination inventory can continue receive, ready, and handoff steps after
  the missing verification is confirmed
- cancelled and fulfilled requests remain immutable except for the existing
  authorized return workflow

This repairs request `#1031` without resetting or fabricating movement events.

## Authorization

For internal branch transfers:

- source inventory may update non-return STN/CERT fields while the transfer is
  `awaiting_source`, `packed`, or `shipped_to_destination`
- destination inventory may perform destination movement actions
- destination inventory retains final-stage verification at `ready_for_rep` as
  a recovery safeguard
- only destination inventory may record returns after handoff
- packing requires ERP BT confirmation, all required STN/CERT fields, and an
  explicit inventory confirmation

Customer shipment and customer drop-off permissions remain source-owned and
unchanged except that packing also requires verification first.

## User Interface

The expanded request card presents:

- request number, sales rep, source branch, and destination branch
- one sentence stating the current task
- STN/CERT controls only for the branch and state that may edit them
- one primary action such as **Confirm and continue to packing**, **Mark
  packed**, **Ship to LA**, **Mark received**, or **Hand to sales rep**
- ERP BT status as compact context rather than competing action controls

The current All/NY/LA/CH filters remain for visibility. Mutation controls are
still determined by the authenticated inventory account's assigned branch.

## Error Handling

- Backend rejections return a short branch-and-step-specific message.
- UI reloads the request after a conflict so stale controls disappear.
- Duplicate account creation is idempotently rejected rather than creating a
  second staff profile.
- Account provisioning runs transactionally so a user cannot exist without its
  branch profile.

## Testing

Automated coverage will prove:

- source NY can check STN/CERT for an NY-to-LA transfer before packing
- another branch cannot edit those fields
- a legacy `shipped_to_destination` request can receive missing source
  verification
- packing fails until required items and resolution are confirmed
- destination receipt and handoff permissions remain branch-scoped
- cancelled and fulfilled mutations remain blocked
- LA and CH inventory accounts resolve to their assigned branch dashboards
- frontend controls match backend capabilities

The complete backend, frontend, desktop, and Rust suites must pass before
deployment. Production verification will confirm API/database health, account
login redirection, request `#1031` editability, and the public application
version.

## Broader Bug Audit

After this workflow passes, the request dashboard will be checked for:

- buttons that are visible but can never be used
- actions that can occur out of order
- duplicate controls for the same state change
- stale UI after successful or rejected API calls
- branch filters that expose mutation controls to the wrong account

Only defects and simplifications directly supported by this workflow are fixed
in this release. Unrelated feature additions are deferred.
