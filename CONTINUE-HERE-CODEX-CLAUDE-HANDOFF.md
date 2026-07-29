# Diamond Inventory — Continue Here

Date: 2026-07-29  
Working branch: `codex/receive-shipments`  
Last completed feature commit before this handoff: `1657f2564feb66442b7faf5520424f415510ac5e`

## Exact continuation point

**Start with Release + Deploy.**

The Receive Shipments feature is implemented, tested, and committed locally.
The user stopped the Windows `1.0.5` release compile before it completed.
Do not assume the new feature is live, and do not claim that a `1.0.5`
installer exists.

Continue in this order:

1. Run the full test matrix again.
2. Change all desktop release metadata from `1.0.4` to `1.0.5`.
3. Build the Windows NSIS installer to completion.
4. Publish the exact installer into the frontend download folder and regenerate
   `frontend/src/release.json`.
5. Commit and push the feature branch, integrate it into the deployed branch,
   and wait for both Render services to become healthy.
6. Create/verify the NY, LA, and CH inventory users in the production database.
7. Perform live smoke tests with all three inventory branches.
8. Only then provide the public `1.0.5` installer URL.

## What is complete

- Source inventory is the only inventory branch that resolves Stone/Cert and
  ships a cross-branch request.
- Destination inventory no longer resolves the source request or uses the
  source branch's grey Stone/Cert boxes.
- A separate **Receive Shipments** dashboard exists for inventory users.
- The logged-in inventory user's branch is the receiving branch; it is not
  accepted from the browser request body.
- One barcode represents both stone and certificate.
- Inventory explicitly records Stone Yes/No and Cert Yes/No.
- Partial stone/certificate arrivals can be recorded on different days and
  roll up to one request.
- Exact matching identifies the request and the local sales rep who should
  receive the package.
- Multiple matches require inventory to choose the request.
- Unmatched packages are retained as **Needs review**, not discarded.
- Duplicate component scans require an explicit override.
- Corrections preserve an audit record.
- Destination inventory can record **Hand to rep** only after every expected
  component for that request has arrived.
- Daily branch-local history, date navigation, filters, search, and Excel
  export are implemented.
- Physical receiving records never toggle Maitri ERP's digital BT-received
  field. ERP BT remains a separate workflow.
- Physical receipt, correction, linking, readiness, and handoff movements are
  added to tracking history.
- Inventory seed definitions now include exactly:

  - `stockny@maitri.nyc` — Inventory NY — NY
  - `stockla@maitri.nyc` — Inventory LA — LA
  - `stockch@maitri.nyc` — Inventory CH — CH

- No passwords or production secrets are stored in source.

## Important commits

```text
1657f25 fix: seed inventory account for every branch
bcf9c57 feat: add inventory shipment receiving dashboard
085a2d1 feat: add branch shipment receipt API
f4a102f feat: add shipment receipt domain
2af0ba5 fix: keep request resolution at source branch
1c8a9f4 docs: plan branch shipment receiving
d90c8bf docs: design branch shipment receiving
```

## Verification already completed

- Backend: 113 tests passed after the receipt API work.
- Staff account seed: 2 additional focused tests passed.
- Frontend: 36 tests passed.
- Frontend production build and static export passed.
- Browser smoke test passed for the new dashboard:

  - page rendered correctly;
  - NY account was fixed to NY receiving;
  - daily history rendered;
  - matching found request `#500` and rep `Keyush` in the mock;
  - Stone Yes and Cert No enabled the save action;
  - no browser console errors were present.

- Desktop configuration: 5 tests passed.
- Rust desktop security/navigation: 3 tests passed.

The `1.0.5` release build itself did **not** finish because the user asked to
stop. Re-run everything before deployment because the final combined release
has not yet been verified.

## Full verification commands

From the repository root in PowerShell:

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
Pop-Location
```

## Build and publish `1.0.5`

Update these files to `1.0.5`:

- `desktop-app/package.json`
- the root package entries in `desktop-app/package-lock.json`
- `desktop-app/src-tauri/Cargo.toml`
- the `diamond-inventory` package entry in
  `desktop-app/src-tauri/Cargo.lock`
- `desktop-app/src-tauri/tauri.conf.json`
- the expected versions in `desktop-app/scripts/config.test.js`
- the expected version and filename in
  `frontend/scripts/static-export.test.js`

Then:

```powershell
Push-Location desktop-app
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
Pop-Location
```

Expected installer:

```text
desktop-app/src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.5_x64-setup.exe
```

Publish it and create matching checksum metadata:

```powershell
.\scripts\publish-windows-installer.ps1 `
  -InstallerPath ".\desktop-app\src-tauri\target\release\bundle\nsis\Diamond Inventory_1.0.5_x64-setup.exe" `
  -Version 1.0.5 `
  -OutputRoot .
```

After publishing, verify:

```powershell
Get-FileHash ".\desktop-app\src-tauri\target\release\bundle\nsis\Diamond Inventory_1.0.5_x64-setup.exe" -Algorithm SHA256
Get-FileHash ".\frontend\public\downloads\DiamondInventory-Setup-1.0.5.exe" -Algorithm SHA256
Get-Content ".\frontend\src\release.json"
```

The two hashes must be identical, and the size/hash in `release.json` must
match the published file.

## Git and deployment

This handoff ZIP contains a Git bundle named
`diamond-inventory-repository.bundle`. To restore the exact branch with
history:

```powershell
git clone .\diamond-inventory-repository.bundle diamond-inventory-work
Set-Location diamond-inventory-work
git switch codex/receive-shipments
git remote set-url origin https://github.com/MaitriDiamondsINC/diamond-inventory.git
```

Before integration, fetch and inspect the remote because it may have advanced:

```powershell
git fetch origin
git status
git log --oneline --decorate --graph --all -20
```

Push the feature branch, review the diff, then integrate it into the branch
that Render deploys. `render.yaml` has automatic deploys for both services.
Do not overwrite remote work; use a normal merge if fast-forward is no longer
possible.

Health checks:

- API liveness:
  `https://maitri-inventory-api.onrender.com/health`
- API/database readiness:
  `https://maitri-inventory-api.onrender.com/ready`
- Web:
  `https://maitri-inventory-web.onrender.com`

Existing installed desktop users load the hosted web app, so the deployed web
update reaches them automatically without reinstalling. The `1.0.5` installer
is still required as the clean public download for new computers.

## Production inventory accounts

The source definitions are fixed, but production accounts still need live
verification after deployment.

Use a newly generated strong temporary password at action time. Never commit
it, put it in a ZIP, terminal log, screenshot, or chat handoff. The seed is
idempotent and requires `STAFF_INITIAL_PASSWORD`.

Verify all three accounts can sign in and that each dashboard says the correct
receiving branch. If the old typo account `stocstockny@maitri.nyc` still
exists, do not delete it until `stockny@maitri.nyc` is confirmed working;
then deactivate the typo account through the admin workflow.

## Live smoke test after deployment

For each of NY, LA, and CH:

1. Sign in with the branch inventory account.
2. Confirm **Receiving at NY/LA/CH** matches the account.
3. Scan a cross-branch requested barcode.
4. Confirm the request and local sales rep are shown.
5. Record Stone Yes / Cert No.
6. Record Cert Yes on a later receipt and confirm the request becomes ready.
7. Confirm the destination inventory can hand it to the local rep.
8. Confirm the source Requests screen still owns source resolution/shipping.
9. Confirm Maitri ERP digital BT fields were not changed by physical receipt.
10. Test unmatched scan, correction, duplicate override, history filter, and
    Excel export.

## Current public installer

The currently published installer remains `1.0.4` and does not prove the new
feature is deployed:

`https://maitri-inventory-web.onrender.com/downloads/DiamondInventory-Setup-1.0.4.exe`

Current tracked `1.0.4` SHA-256:

```text
4E430C85EFA0D970098278C774E30665F2940861AE08F7AB19A9A003EA566E34
```

Do not give a `1.0.5` URL until the build, publish, deployment, and live smoke
test above all succeed.

## Key technical files

- Receipt schema:
  `backend/src/db/schema.sql`
- Receipt rules:
  `backend/src/services/receiptService.js`
- Receipt HTTP API:
  `backend/src/routes/receipts.js`
- Excel export:
  `backend/src/services/receiptExportService.js`
- Receiving dashboard:
  `frontend/src/app/dashboard/receiving/page.tsx`
- Typed client:
  `frontend/src/lib/api.ts`
- Frontend receiving rules:
  `frontend/src/lib/receiving.ts`
- Inventory account definitions:
  `backend/src/db/staffAccounts.js`
- Approved design:
  `docs/superpowers/specs/2026-07-29-branch-shipment-receiving-design.md`
- Implementation plan:
  `docs/superpowers/plans/2026-07-29-branch-shipment-receiving.md`

## Security and packaging

- Do not include `.env` files, database URLs, JWT secrets, temporary
  passwords, `node_modules`, Rust `target`, frontend `out`, or `.git` in a
  shareable source archive.
- The Git bundle contains repository history only; it does not contain
  untracked environment files.
- The desktop wrapper has no terminal window in release mode and grants no
  Tauri capabilities to hosted inventory content.
