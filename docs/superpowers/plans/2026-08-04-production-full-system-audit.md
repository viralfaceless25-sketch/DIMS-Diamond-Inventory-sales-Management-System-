# DIMS Production Full-System Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exercise every safely testable DIMS production workflow across NY, LA, and CH, repair every reproducible defect with TDD, and produce an evidence-backed report without deploying fixes before user approval.

**Architecture:** Combine the complete local automated suites with authenticated production API/socket scenarios and Chrome UI smoke tests. Use uniquely tagged test-account requests, assert exact branch/role isolation, capture sanitized JSON and screenshots, and keep all fixes on `audit/full-production-e2e` until approval.

**Tech Stack:** Node.js, Express, PostgreSQL/Supabase, Next.js, Socket.IO, Node test runner, Playwright with installed Chrome, Render production services.

## Global Constraints

- Never write credentials, JWTs, or database secrets to repository files, reports, screenshots, shell output, or Git history.
- Do not push, merge, deploy, upload replacement stock, clear test data, disable users, or reset passwords without explicit authorization for that specific effect.
- Preserve `/Volumes/ai-hub/DIMS/graphify-out/`.
- Every defect requires a reproducible root cause and a failing regression test before production code changes.
- Evidence must identify test case, actor/branch, expected result, actual result, timestamp, and artifact without exposing customer or credential data.

---

### Task 1: Establish baseline and inventory the surface

**Files:**
- Create: `artifacts/production-audit-2026-08-04/coverage.json`
- Create: `artifacts/production-audit-2026-08-04/dependency-audit.json`

**Interfaces:**
- Consumes: repository tests, route declarations, Graphify knowledge graph
- Produces: canonical endpoint/page/role coverage checklist used by every later task

- [ ] Run backend tests, frontend tests, frontend production build, `git diff --check`, and production dependency audits.
- [ ] Enumerate every backend route, frontend page, socket event, role boundary, branch direction, request scope, fulfillment choice, document step, receipt action, and tracking filter.
- [ ] Record baseline outcomes and dependency advisories with no credentials or tokens.

### Task 2: Authenticate all six test users and validate session security

**Files:**
- Create: `artifacts/production-audit-2026-08-04/auth-results.json`

**Interfaces:**
- Consumes: three sales and three inventory accounts supplied in-session through process memory only
- Produces: in-memory authenticated sessions for later API/socket/UI scenarios

- [ ] Log in each account; if forced, change the temporary password and reauthenticate without persisting credentials.
- [ ] Assert `/me`, correct role/branch, forced-password routing, logout/token invalidation behavior, malformed login rejection, and cross-role route denial.
- [ ] Verify every account can reach only its own role shell and branch-scoped data.

### Task 3: Discover safe production test stock and fixtures

**Files:**
- Create: `artifacts/production-audit-2026-08-04/fixture-inventory.json`

**Interfaces:**
- Consumes: authenticated stock endpoints for NY, LA, CH
- Produces: sanitized barcode/type selections and bounded PDF/image fixtures

- [ ] Query loose and jewelry inventory, filters, pagination, options, search, and availability labels in every branch.
- [ ] Select requestable test items owned by each branch and record only test-relevant identifiers.
- [ ] Create minimal valid PDF/PNG/JPEG fixtures and invalid upload fixtures without customer data.
- [ ] Exercise invoice parsing and stock-upload rejection paths; do not replace live stock.

### Task 4: Exercise request creation and notification routing

**Files:**
- Create: `artifacts/production-audit-2026-08-04/request-matrix.json`
- Create: `artifacts/production-audit-2026-08-04/socket-events.json`

**Interfaces:**
- Consumes: authenticated sessions and safe stock fixtures
- Produces: uniquely identified local and cross-branch requests covering all scopes/routes

- [ ] Cover `stone_and_cert`, `stone_only`, and `cert_only`; loose and jewelry items; manual, paste/invoice-facing source values; and urgent, local, ship, drop-off, pickup labels where supported.
- [ ] Cover all four local fulfillment choices in NY, LA, and CH.
- [ ] Cover all six ordered cross-branch directions and all four BT fulfillment choices, distributing scopes and item types across the matrix.
- [ ] Assert inventory-created popup reaches only fulfillment inventory and includes requester, branch, scope/type, count, and at most three barcodes.
- [ ] Assert invalid mixed-source, duplicate, missing, inactive, unauthorized, malformed, and oversized requests fail without partial writes.

### Task 5: Exercise resolution, viewed, confirmation, and immutability

**Files:**
- Update: `artifacts/production-audit-2026-08-04/request-matrix.json`
- Update: `artifacts/production-audit-2026-08-04/socket-events.json`

**Interfaces:**
- Consumes: requests from Task 4
- Produces: resolved requests with exact lifecycle and notification evidence

- [ ] Open every request from authorized inventory; assert only source inventory creates the first-view transition and only the exact requester receives the popup.
- [ ] Cover per-row and bulk STN, CERT, and Not Found; mutual exclusion; mixed found/not-found; untouched-row confirmation rejection; applicable-scope enforcement; and post-confirm immutability.
- [ ] Confirm requests; assert exact-user popup text, durable viewed/confirmed timestamps, stable idempotency, active/completed queue movement, statistics, and search/sort behavior.
- [ ] Assert unrelated branch inventory and unrelated sales users cannot read or mutate request details.

### Task 6: Exercise ERP, documents, physical transfer, receipts, and returns

**Files:**
- Create: `artifacts/production-audit-2026-08-04/transfer-receipt-results.json`

**Interfaces:**
- Consumes: resolved delivery requests from Task 5 and safe files from Task 3
- Produces: completed internal/customer delivery lifecycles and receipt evidence

- [ ] Exercise ERP BT issue, unavailable rejection, sales receive request, destination ERP receipt, and every invalid ordering/branch denial.
- [ ] Exercise paperwork choice, valid PDF/image upload/download, valid label upload/download, MIME/signature mismatch, unsafe filename, ownership, and immutable-document gates.
- [ ] Exercise internal pack/ship/receive/ready/handoff and customer pack/ship/drop-off transitions with correct source/destination actors.
- [ ] Exercise receipt lookup, matched/unmatched receipt validation, stone/cert partial arrival, duplicate protection/override denial, correction, link, daily filters/export, and final handoff.
- [ ] Exercise returned-item recording without reopening confirmed resolution.

### Task 7: Exercise rechecks, tracking, UI, accessibility, and resilience

**Files:**
- Create: `artifacts/production-audit-2026-08-04/ui-results.json`
- Create: `artifacts/production-audit-2026-08-04/screenshots/`

**Interfaces:**
- Consumes: lifecycle data created by Tasks 4-6
- Produces: browser-visible evidence across all pages and branches

- [ ] Exercise stock recheck request, source-inventory resolution, one-time consumption, unavailable result, queue filters, and cross-branch denial.
- [ ] Exercise sales and inventory tracking search, branch scope, movement filters, pagination, snapshot/reconciliation, and lifecycle history.
- [ ] In Chrome, visit every accessible page for each role/branch; verify navigation, empty/loading/error states, deep links, popup click/dismiss/timeout/keyboard behavior, responsive layout, console errors, failed network calls, focus, labels, and screenshots.
- [ ] Verify admin pages and endpoints deny all supplied non-admin accounts.
- [ ] Exercise API cold-start/readiness handling, invalid sessions, malformed payloads, rate/size limits without triggering account lockouts or service disruption.

### Task 8: Repair defects and complete report

**Files:**
- Modify: only root-cause files identified by failing scenarios
- Test: matching backend or frontend regression tests for every fix
- Create: `artifacts/production-audit-2026-08-04/REPORT.md`

**Interfaces:**
- Consumes: failures and artifacts from Tasks 1-7
- Produces: verified local commits and final approval report

- [ ] For each defect, reproduce consistently, trace the failing boundary, state one root-cause hypothesis, and add a focused failing test.
- [ ] Implement the minimal fix, run focused tests, then rerun affected end-to-end scenarios.
- [ ] Run backend tests, frontend tests, production build, dependency audit, `git diff --check`, and independent code review.
- [ ] Report passed, failed, fixed, blocked, and intentionally untested cases; list commits and artifacts; do not push or deploy until user approval.
