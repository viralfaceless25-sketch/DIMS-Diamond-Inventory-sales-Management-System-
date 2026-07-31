# Continue Exactly Here — 2026-07-31 session handoff

Repo: `viralfaceless25-sketch/DIMS-Diamond-Inventory-sales-Management-System-`
Working branch: `claude/diamond-inventory-handoff-93umvq` (kept in sync with `main`)
Deploys: push to `main` → Render auto-deploys both services
(`maitri-inventory-api` rootDir `backend`, `maitri-inventory-web` rootDir
`frontend`, build `npm ci && npm run build`, publish `./out`).
Live verified this session: `/health` `{"ok":true}`, `/ready`
`{"ok":true,"database":"ready"}`, download page shows 1.0.5, installer
SHA-256 matches `A5FD…2877`.

## EXACT STOP POINT

Mid-task on **task 12: make cert / non-cert filterable and noticeable**.

I had just inspected `frontend/src/app/dashboard/stock/page.tsx` and found:
- Line ~244: a `ChipRow` Status filter (available/on_memo/on_hold/in_transit)
  — this is the pattern to copy for a new **Certified / Non-cert** filter chip
  row (loose stones: `certificate_no` present vs null; jewelry: `cert_no`).
- The stock table's CERT # column exists; a visible badge (e.g. "NON-CERT" in
  amber) should be added where cert is null, and the same noticeable treatment
  wherever stones render: rep request-stones grid (line ~679 shows
  `certificate_no` faintly), my-requests stone rows, tracking rows, receiving
  candidates.
- Backend: `/api/stock/loose` + `/jewelry` in `backend/src/routes/stock.js`
  have no has-cert filter yet — add e.g. `cert=none|any` or `hasCert=true/false`
  query param (see `addLikeFilter` usage around lines 186/274 for the pattern).

Nothing for task 12 has been written yet — investigation only.

## UNCOMMITTED WORK IN THIS COMMIT

`backend/src/routes/admin.js` — new `POST /api/admin/clear-test-data`
(admin-only; `?dryRun=true` previews row counts; real run requires body
`{"confirm":"DELETE TEST DATA"}`). Deletes: requests (cascades to
request_stones/paperwork/labels), stone_movements, loose_diamonds,
jewelry_pieces. Keeps users/sales_reps/branches. **Reviewed by reading, but
never syntax-executed or endpoint-tested** — the sandbox's safety classifier
blocked running anything against this file. Verify before relying on it:
`node -c backend/src/routes/admin.js`, then dry-run:
`POST /api/admin/clear-test-data?dryRun=true` with an admin Bearer token.
The equivalent reviewed SQL script was also delivered to the user
(clear-test-data.sql — Supabase SQL editor / psql). User has NOT yet chosen
endpoint vs script; data is NOT yet deleted.

## REMAINING TODO (user requests from 2026-07-31, in order)

1. **Task 12 (in progress, see stop point):** cert / non-cert badge + filter
   everywhere relevant (stock browse both tables, rep request grid,
   my-requests, tracking, receiving).
2. **Task 13:** change app font to something professional/simple. Note:
   `frontend/src/app/globals.css` imports Inter at weights 400–700 only, but
   code uses 700/800 heavily (800 is never actually loaded — browsers fake it).
   Options: load Inter 800 too, or swap family app-wide. ~1000 inline
   `font: "… 'Inter'"` shorthands exist — scripted sed replace is the way.
3. **Task 14:** increase every font size by 2px app-wide (same scripted pass
   over inline `font:` shorthands + px values), then verify no overflow —
   fixed-width grid columns like `STONE_TABLE_COLS` in dashboard/requests and
   `summaryCols` in tracking are the overflow risks; build + eyeball needed.
4. **Test-data cleanup:** after user picks endpoint or SQL script, run/confirm
   deletion (request/stock/tracking data only; keep accounts).
5. Optional/possible: `shipment_receipts` + `stock_recheck_requests` were
   flagged to the user as probable test data too — not included in defaults.

## VERIFY AFTER ANY CHANGE

- `cd frontend && npx tsc --noEmit && npm test && npm run build`
- `node --test backend/test/<file>.test.js` for dependency-free backend tests
  (full `npm ci` in backend fails here: cdn.sheetjs.com blocked; pg/express
  tests need node_modules — "Cannot find module" failures are pre-existing).
- Keep files LF; commit on `claude/diamond-inventory-handoff-93umvq`, then
  fast-forward push same SHA to `main` to deploy.

## KEY CONVENTIONS THIS SESSION

- Barcode extraction: shared `extractBarcodes()` / `BARCODE_PATTERN` in
  `frontend/src/lib/utils.ts` (5–10 digits, hyphen, 2–6 alphanumerics) —
  every search/scan box multi-barcode-paste-safe; mirror of backend
  `invoiceParser.js`.
- Click-to-copy: `Copyable` in `frontend/src/components/ui.tsx` — use for any
  barcode/cert display; no copy buttons.
- Requestable statuses: available/on_hold/on_memo/in_transit
  (`backend/src/services/stockStatus.js`, `frontend/src/lib/requestWorkflow.ts`);
  only not_in_snapshot and duplicate-holder block.
- Inventory rooms are branch-locked server-side
  (`backend/src/services/branchScope.js` + `req.user.branch` from requireAuth).
