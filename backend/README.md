# Diamond Inventory Backend

Single source of truth for the **Diamond Dashboard** (inventory staff) and
**Sales Rep Request** (sales reps) apps across NY / LA / Chicago. Replaces the
two prototypes' separate in-memory mock data with one shared Postgres
database, a REST API, and Socket.io real-time sync.

Built per `design_handoff_diamond_inventory/README.md` — see that file for
the full UI/data-model spec this backend implements.

## Stack
- **Node.js + Express** — REST API
- **Postgres** (via [Neon](https://neon.tech), free tier, serverless — no
  credit card) — the shared database all 3 branches read/write
- **Socket.io** — real-time push so a stone checked off in the Dashboard
  instantly updates the rep's "My requests" view, and vice versa
- **xlsx** — server-side parsing of stock upload spreadsheets
- **pdf-parse** — real (non-mock) invoice PDF text extraction

Real JWT auth with role-based access is implemented. Two roles: `inventory`
(full dashboard) and `sales_rep` (scoped to their own data). Identity for
writes comes from the token, never the request body. See "Auth & roles" below.

---

## 1. Free cloud setup (Neon + Render)

### Database — Neon
1. Go to https://neon.tech → sign up free → **New Project**.
2. Once created, copy the **connection string** shown (starts with
   `postgres://...`). This is your `DATABASE_URL`.
3. That's it — no server to manage, and the free tier is enough for this
   workload (it auto-suspends when idle and wakes on the next request).

### API hosting — Render
1. Push this folder to a GitHub repo.
2. Go to https://render.com → sign up free → **New +** → **Web Service** →
   connect your repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Add Environment Variables (Render dashboard → Environment):
   - `DATABASE_URL` = the Neon connection string
   - `DATABASE_SSL` = `true`
   - `CORS_ORIGIN` = `*` for now (tighten once your frontends have real URLs)
5. Deploy. Render gives you a URL like `https://diamond-inventory-backend.onrender.com`.
6. **Run the migration once** against the live database. Easiest way: from
   your own machine, with `DATABASE_URL` in a local `.env` pointed at the
   Neon connection string, run:
   ```
   npm install
   npm run migrate
   ```
   This applies `src/db/schema.sql` (branches, tables, indexes, and the
   seed branch/rep rows). It's safe to re-run.

That's the whole deployment — free, cloud-hosted, and reachable from all 3
branches since it's one server + one database, not per-branch local files.

**Free-tier caveat:** Render's free web service spins down after ~15 min of
no traffic and takes ~30-50s to wake on the next request. If that first-load
delay is a problem once reps are relying on this daily, the fix is a paid
Render instance (~$7/mo) — everything else about the setup stays identical.

### Local development
```
cp .env.example .env
# paste your Neon DATABASE_URL into .env
npm install
npm run migrate
npm run dev
```
Server runs on `http://localhost:4000`.

---

## 2. Data model

Mirrors the spec's data model 1:1:
- `branches` — NY / LA / CH (seeded)
- `sales_reps` — seeded with "Parthik Davra" (NY) to match the prototype;
  add more via `POST /api/reps`
- `loose_diamonds` — "General Client Format" stock
- `jewelry_pieces` — "JS Client Format" stock
- `requests` — one row per submitted batch
- `request_stones` — one row per stone within a batch, with independent
  `stone_found` / `cert_found` / `returned` booleans + timestamps

See `src/db/schema.sql` for full column definitions and comments.

### Business rules, and where they live
- **Batch status** (Awaiting / Half fulfilled / Fulfilled) —
  `src/services/statusService.js`. Recomputed and cached on the `requests`
  row every time any stone in the batch is toggled.
- **Active vs Completed** — a `fulfilled` batch is automatically excluded
  from the `view=active` list and only shows under `view=completed`
  (`GET /api/requests?view=`).
- **Stone sort order** (Color → Clarity → Shape → Size) —
  `src/services/sortingService.js`. Applied everywhere stones are returned:
  request detail, invoice extraction results, "My requests".
- **Duplicate detection** — `src/services/duplicateService.js`. A barcode
  referenced by 2+ *active* (non-returned) requests from *different* reps is
  flagged, with the other rep(s) named — used both for the Requests tab's
  ⚠ badge and the Stock tab's "Availability" column.

---

## 3. API reference

All responses are JSON. Base path: `/api`.

### Branches
- `GET /branches` → `[{ id, name }]`

### Sales reps
- `GET /reps` → `[{ id, name, branch }]`
- `POST /reps` `{ name, branch }` → created rep

### Stock
- `GET /stock/loose?branch=NY&audience=rep` — `audience=rep` strips `cost`
  (never shown to sales reps, per spec). Each item includes `availability:
  { status: 'in_stock'|'requested'|'conflict', holders: [...] }`.
- `GET /stock/jewelry?branch=NY`
- `POST /stock/upload` — multipart, field name `file`, `.xlsx` or `.csv`.
  Parses server-side (header aliasing handles common column-name variants —
  see `src/utils/columnMapping.js`), groups rows by their `Branch` column,
  and **replaces** each matching branch's stock list. A single upload can
  refresh multiple branches at once. Returns
  `{ format, branchesUpdated, rowsImported, skippedBranches }`.

### Requests (Requests tab + Sales Rep submission)
- `GET /requests/stats?branch=ALL` → the 4 stat cards
  `{ pendingRequests, stonesRequested, duplicateFlags, fulfilledRequests }`
- `GET /requests?branch=ALL&view=active|completed&sort=recent|most_stones&search=`
  → list of batches with rep, stone count, status, `hasDuplicate` flag
- `GET /requests/:id` → full batch detail, stones sorted + duplicate-annotated
- `POST /requests` `{ salesRepId, branch, stones: [{ barcode, itemType }], source }`
  → creates a batch (sales rep submission). Broadcasts `request:created`.
- `PATCH /requests/:id/stones/:stoneId` `{ field: 'stone_found'|'cert_found'|'returned', value: boolean }`
  → toggles one checkbox, recomputes batch status, broadcasts `request:updated`
  (and `request:completed` if it just became Fulfilled)
- `PATCH /requests/:id/check-all` `{ value: boolean }` → the batch-level
  "check all" toggle (sets every stone's stone+cert found in one call)
- `GET /requests/by-rep/:repId` → powers "My requests" (read-only per-stone view)

### Tracking
- `GET /tracking?branch=ALL&search=` → flat audit log, one row per requested
  stone, with a derived `trackingStatus`:
  `requested | partially_given | with_rep | returned`

### Invoice extraction
- `POST /invoice/extract` — multipart, field name `file`, a PDF.
  Replaces the prototype's hardcoded mock. It extracts the PDF's text, parses
  each line-item row (barcode, shape, carat, color, clarity, cert), and for
  every barcode also tries to match it against your own inventory. **Inventory
  data wins when present** (it's your clean gemological record); when a stone
  on the invoice isn't in inventory yet, it **falls back to the data parsed
  from the invoice itself** rather than dropping the stone — validated against
  known color/clarity value sets (a row that doesn't validate comes back with
  `confidence: 'low'` and null'd fields instead of garbage). Each stone carries
  a `source` of `'inventory'` or `'invoice'`. Returns
  `{ stones, matchedCount, parsedFromInvoiceCount, notInInventory }`, or a
  `warning` if the PDF has no text layer (scanned/image invoices need an OCR
  step in front of this — flagged clearly rather than silently returning
  nothing). Verified against real Maitri invoice + memo samples.

---

## 4. Real-time sync (Socket.io)

Both frontends should connect to the same server and emit `join-branch`
with the branch they're viewing (or `'ALL'` for the dashboard's unfiltered
view):

```js
const socket = io('https://your-backend.onrender.com');
socket.emit('join-branch', 'NY'); // or 'ALL'

socket.on('request:created', ({ requestId, branch }) => { /* refetch list */ });
socket.on('request:updated', ({ requestId, status }) => { /* refetch that request */ });
socket.on('request:completed', ({ requestId }) => { /* move it to Completed */ });
socket.on('stock:updated', ({ branch, format }) => { /* refetch stock list */ });
```

The simplest correct client behavior is: on any event, refetch the relevant
list/detail rather than trying to patch local state from the socket payload
— the payloads are intentionally minimal (just IDs), and a refetch is cheap
against Neon on the free tier's own indexes.

---

## 5. Adding auth later

Nothing here assumes "no auth" in a way that's hard to undo:
- Every write endpoint already takes `salesRepId` explicitly rather than
  inferring identity from anywhere global — swap that for
  `req.user.id` from a real session/JWT once auth exists.
- `GET /reps` returning everyone is the one thing that changes shape — it'd
  become "get the logged-in rep" instead.
- Add an `express` auth middleware in `src/middleware/` (empty folder is
  already scaffolded) and apply it to the routers in `src/server.js`.

---

## 6. Known gaps carried over from the design spec

Per `design_handoff_diamond_inventory/README.md`'s "Known Gaps" section:
1. ~~Invoice PDF extraction~~ — now real, and verified against actual Maitri
   invoice + memo samples. Parses full stone rows from the PDF text and merges
   with inventory (inventory authoritative, invoice-parsed as fallback).
   Limited to PDFs with a text layer; scanned invoices need an OCR step in
   front of the same parse-and-merge logic.
2. ~~Two apps not sharing data~~ — solved; this backend is the shared store.
3. **No auth/user accounts** — by your choice, deferred. See section 5.
4. ~~No persistence~~ — solved; Postgres via Neon.
5. **Stock upload has no versioning/undo** — each upload replaces the
   affected branch's rows outright. If you want an audit trail of past
   uploads or an "undo last import" button, that's a small addition (a
   `stock_uploads` table logging each batch) — flag it if you want it next.
