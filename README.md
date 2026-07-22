# Maitri Diamond Inventory

Shared inventory and request software for the NY, Chicago, and Los Angeles offices. Sales reps browse combined stock and submit review-first requests; inventory staff find, scan, partially fulfill, and confirm those requests in real time.

## What it does

- One login system for sales reps, inventory, and administrators.
- Combined loose-diamond and jewelry stock across NY, CH, and LA.
- Availability protection for in-stock, on-memo, on-hold, and already-requested items.
- Barcode requests, pasted stock-detail extraction, and invoice/memo PDF extraction. PDF extraction never sends automatically.
- Request scope: stone + cert, stone only, or cert only.
- Request types: urgent, local, ship, drop-off, and pickup.
- Cross-branch routing for all six office-to-office directions, including direct shipment or drop-off to a customer.
- Pending-label and pending-paperwork flags for customer shipments.
- Inventory barcode scanning, partial fulfillment, global stone/cert/return controls, and an explicit Confirm action.
- Daily Excel stock uploads for loose diamonds and jewelry.
- Real-time updates using Socket.io.

## Current live setup

- Host PC frontend: `http://localhost:3000`
- Office-network frontend: `http://192.168.1.235:3000` while that is the host PC's private IP
- API health check: `http://127.0.0.1:4000/health`
- Database currently in use: Supabase Postgres through `backend/.env`, using the Session pooler and a pinned Supabase CA certificate.
- CockroachDB remains unchanged as a rollback source. Its prior connection configuration is saved locally in `backend/.env.cockroach-backup-2026-07-15` and is intentionally excluded from handoff archives.

The Windows launcher starts the optimized backend and frontend. It is designed for an always-on office PC; the PC must remain powered on and signed in.

## Daily operation

1. Start the host PC and sign in to its Windows account.
2. Confirm `http://localhost:3000` opens. If it does not, run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Users\zeel1\diamond-inventory\desktop\Launch-DiamondInventory.ps1 -OpenApp
   ```
3. Inventory uploads the day's loose-diamond and jewelry Excel workbooks from **Stock & Upload**.
4. Sales reps open `http://192.168.1.235:3000` from the Maitri network, sign in, select a supplying branch and delivery branch, review their cart, then submit.
5. Inventory opens **Requests**, expands a request, scans physical barcodes, selects only the items found, and uses **Confirm** to resolve it. Partial resolution is allowed and remains visible in tracking.

## Running or restarting locally

The launcher is the normal method:

```powershell
cd C:\Users\zeel1\diamond-inventory
powershell -ExecutionPolicy Bypass -File .\desktop\Launch-DiamondInventory.ps1 -OpenApp
```

For development, use two PowerShell windows:

```powershell
cd C:\Users\zeel1\diamond-inventory\backend
npm.cmd run dev:lan
```

```powershell
cd C:\Users\zeel1\diamond-inventory\frontend
npm.cmd run dev:lan
```

To create the optimized frontend used by the launcher:

```powershell
cd C:\Users\zeel1\diamond-inventory\frontend
npm.cmd run build
```

## Database and environment

Secrets are intentionally excluded from the handoff archive. Create `backend/.env` from `backend/.env.example` and set:

- `DATABASE_URL`: the active CockroachDB or future Supabase database URL.
- `DATABASE_SSL=true`: required for managed cloud databases.
- `JWT_SECRET`: a long random secret, unique to this system.
- `CORS_ORIGIN`: use the real frontend URL in cloud hosting; `*` is suitable only for controlled LAN testing.
- `PORT=4000`.

Run schema setup only for an empty database:

```powershell
cd backend
npm.cmd run migrate
```

The Supabase migration commands are:

```powershell
cd backend
npm.cmd run migrate:supabase
npm.cmd run migrate:to-supabase
```

The copy is only for an empty target and verifies each table count before committing. Read `CODEX_HANDOFF_2026-07-14.md` before using it; do not repeat the copy against the live Supabase database.

## Staff accounts

The complete staff roster is in `backend/src/db/seedStaff.js`. To add only missing staff accounts:

```powershell
cd backend
$env:STAFF_INITIAL_PASSWORD = 'Temporary-Strong-Password'
npm.cmd run seed:staff
```

Every newly-created user is forced to change the temporary password at first login. Never put real passwords in a source file or handoff archive.

## Network access

The frontend automatically calls port 4000 on the same host name, so sales PCs must use the host PC IP rather than `localhost`. If another Maitri-network PC cannot connect, run these once on the host PC as Administrator:

```powershell
netsh advfirewall firewall add rule name="Diamond Inventory Frontend 3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="Diamond Inventory Backend 4000" dir=in action=allow protocol=TCP localport=4000
```

## Verification

```powershell
cd backend
npm.cmd test

cd ..\frontend
npm.cmd run build
```

The frontend build validates TypeScript and produces the optimized application. The backend tests cover the deployment configuration, stock column mapping, and transfer/paperwork rules.

## Project map

- `frontend/`: Next.js sales and inventory interfaces.
- `backend/`: Express API, Socket.io, authentication, database migrations, Excel/PDF processing.
- `desktop/`: Windows launcher and autostart scripts.
- `docs/`: reference notes.
- `CODEX_HANDOFF_2026-07-14.md`: current technical handoff for the next developer or Codex session.

## Important safety rules

- Do not share `.env`, database URLs, JWT secrets, or passwords.
- Do not run the Supabase copy into a non-empty destination.
- Do not use the daily stock upload until the workbook branch values have been checked; the upload replaces stock for the branches in that workbook.
- Do not treat a scanned/found item as resolved until inventory selects the correct stone/cert choices and presses Confirm.
