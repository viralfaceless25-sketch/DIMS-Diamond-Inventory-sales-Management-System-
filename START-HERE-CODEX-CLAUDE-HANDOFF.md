# Diamond Inventory 1.0.5 - Codex / Claude Handoff

Release date: 2026-07-30

## Start here

This repository contains the shared Maitri Diamond Inventory system:

- Render-hosted Node/Express API with PostgreSQL/Supabase storage
- Render-hosted static Next.js frontend
- Windows Tauri wrapper that opens the hosted frontend without a terminal
- NSIS installer for a new Windows 10 or Windows 11 computer

The Windows wrapper loads hosted content, so existing installed users receive
frontend/backend workflow updates automatically after Render deploys the new
Git commit. They do not need to reinstall for hosted workflow changes.

## Release 1.0.5

- Public download page:
  `https://maitri-inventory-web.onrender.com/download/`
- Direct installer:
  `https://maitri-inventory-web.onrender.com/downloads/DiamondInventory-Setup-1.0.5.exe`
- Filename: `DiamondInventory-Setup-1.0.5.exe`
- Size: `1184110` bytes
- SHA-256:
  `A5FD347343C063B61EC38FB847C517F8CCB48F4D236E5B2B645608B518322877`

The installer is not code-signed. Windows SmartScreen may show
"Windows protected your PC." Check the filename and SHA-256, select
**More info**, and then **Run anyway**.

## What 1.0.5 adds

- A separate **Receive Shipments** inventory page for NY, LA, and CH.
- Receiving branch is derived from the authenticated inventory user.
- One scan uses the shared stone/certificate barcode.
- Inventory explicitly records Stone Yes/No and Cert Yes/No.
- Partial stone and certificate arrivals can be recorded on different dates.
- Automatic matching shows the original request and destination sales rep.
- Multiple eligible requests require inventory to select the correct request.
- Unmatched packages are retained as **Needs review**.
- Duplicate component scans require an explicit override.
- Corrections and handoffs are audited.
- Daily branch-local history includes filters, search, and Excel export.
- Source inventory alone resolves and ships the source request.
- Destination inventory receives physical shipments and hands them to its
  local sales rep.
- Physical receiving never changes Maitri ERP's digital BT-received field.
- Tracking includes physical receipt, correction, linking, readiness, and
  handoff movements.

## Three separate states

Do not combine these states:

1. **Daily ERP snapshot**
   - Imported from Excel.
   - Represents in-stock, on-hold, and on-memo facts at upload time.
   - In-transit remains supported for future API integration.

2. **Maitri ERP digital BT**
   - Source branch issues the BT.
   - Destination branch may receive the BT digitally when the rep needs to
     invoice or memo.
   - This is independent of physical arrival.

3. **Physical shipment receipt**
   - Destination inventory scans what physically arrived.
   - Stored in `shipment_receipts`.
   - Rolls up stone/certificate components and identifies the local rep.

## Inventory accounts

The deterministic inventory identities are:

- `stockny@maitri.nyc` - Inventory NY - branch NY
- `stockla@maitri.nyc` - Inventory LA - branch LA
- `stockch@maitri.nyc` - Inventory CH - branch CH

Passwords are intentionally not stored in Git or this handoff. New accounts
must receive strong temporary passwords through a private channel and change
them at first login.

If the obsolete typo account `stocstockny@maitri.nyc` exists, first verify
that `stockny@maitri.nyc` can log in and shows **Receiving at NY**, then
deactivate the typo account through the admin workflow.

## Important folders

```text
backend/       API, migrations, database schema, tests
frontend/      Next.js frontend and public installer
desktop-app/   Tauri Windows wrapper and NSIS build
scripts/       Release publishing script
tests/         PowerShell release-script tests
docs/          Approved designs and implementation plans
```

Key feature files:

- `backend/src/db/schema.sql`
- `backend/src/routes/receipts.js`
- `backend/src/services/receiptService.js`
- `backend/src/services/receiptExportService.js`
- `backend/src/services/requestAuthorization.js`
- `frontend/src/app/dashboard/receiving/page.tsx`
- `frontend/src/lib/receiving.ts`
- `frontend/src/lib/api.ts`
- `backend/src/db/staffAccounts.js`

## Receipt API

All receipt endpoints require an authenticated inventory user:

```text
GET    /api/receipts/lookup
GET    /api/receipts
GET    /api/receipts/export
POST   /api/receipts
PATCH  /api/receipts/:id
PATCH  /api/receipts/:id/link
POST   /api/receipts/requests/:requestId/handoff
```

The server derives the receiving branch from the user's inventory profile.
Never add a client-controlled receiving-branch override.

## Local setup and verification

Use Node.js 18 or newer, npm, Rust stable MSVC, and Windows NSIS support.

```powershell
Push-Location backend
npm ci
npm test
Pop-Location

Push-Location frontend
npm ci
npm test
npm run build
Pop-Location

Push-Location desktop-app
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
Pop-Location
```

Expected installer:

```text
desktop-app/src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.5_x64-setup.exe
```

Publish an installer only through:

```powershell
.\scripts\publish-windows-installer.ps1 `
  -InstallerPath ".\desktop-app\src-tauri\target\release\bundle\nsis\Diamond Inventory_1.0.5_x64-setup.exe" `
  -Version 1.0.5 `
  -OutputRoot .
```

The publisher refuses to overwrite an existing version with different bytes.

## Render deployment

`render.yaml` defines:

- API: `maitri-inventory-api`
- Web: `maitri-inventory-web`

Both auto-deploy from the configured Git branch after a GitHub push.
Backend startup applies idempotent schema migrations before serving traffic.

Verify:

```text
https://maitri-inventory-api.onrender.com/health
https://maitri-inventory-api.onrender.com/ready
https://maitri-inventory-web.onrender.com/dashboard/receiving/
https://maitri-inventory-web.onrender.com/download/
```

Render's free service can sleep. `/health` checks process liveness; `/ready`
checks database readiness and can take longer after a cold start.

## Production smoke test

For each NY, LA, and CH inventory login:

1. Confirm the page displays the correct fixed receiving branch.
2. Look up a known cross-branch requested barcode without writing fake data.
3. Confirm the request and destination sales rep are identified.
4. Confirm source request Stone/Cert resolution remains source-only.
5. Export one receipt-history date.
6. Verify the direct installer download has the release SHA-256 above.

Do not create fake production receipts only for testing.

## Rollback

- Preserve the database; never delete receipt or audit rows for rollback.
- Revert the application commit and redeploy the prior Git commit.
- The new schema is additive and may remain in place.
- Keep the prior versioned installer in `frontend/public/downloads`.
- Restore `frontend/src/release.json` to the prior immutable installer if the
  download page must roll back.
- Do not overwrite an existing versioned EXE with different bytes.

## Security

- Never commit `.env` files, database URLs, JWT secrets, passwords, tokens,
  `node_modules`, Rust `target`, frontend `out`, or `.git`.
- The hosted page receives no Tauri capabilities.
- Navigation is restricted to the HTTPS inventory origin.
- The release desktop application uses the Windows GUI subsystem, so it does
  not open a terminal window.
