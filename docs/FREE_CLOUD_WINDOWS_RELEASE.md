# Diamond Inventory: Free Cloud and Windows Release Runbook

## Production topology

- Public web and installer: `https://maitri-inventory-web.onrender.com`
- API and Socket.IO: `https://maitri-inventory-api.onrender.com`
- Database: the existing Supabase Postgres project, reached only by the API
- Windows app: a current-user NSIS installer that opens the HTTPS web app in WebView2

Render's free API can sleep after 15 minutes without inbound HTTP or WebSocket traffic and can take about one minute to wake. The client probes only `GET /ready` for up to 90 seconds and never retries inventory writes. The static download site does not sleep.

## First deployment

1. Push the repository to a private GitHub repository.
2. In Render, create a Blueprint from the repository. Render reads the root `render.yaml` and creates the API and static site.
3. On `maitri-inventory-api`, set `DATABASE_URL` to the Supabase session-pooler connection string. Never place this value in Git, a ticket, a screenshot, or chat.
4. Confirm Render generated `JWT_SECRET`; rotate it if it was ever copied outside Render.
5. Deploy both services. Confirm the final Render hostnames exactly match the two URLs above before distributing the desktop installer.
6. Run the API migrations once from a trusted workstation using the same production `DATABASE_URL`: `npm.cmd run migrate` from `backend`.
7. Verify `/ready`, `/login/`, `/download/`, and the published EXE before inviting users.

## Release a Windows installer

Build the desktop app with `DIAMOND_INVENTORY_WEB_URL` set to the final HTTPS web origin. Then publish the NSIS artifact:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-windows-installer.ps1 `
  -InstallerPath 'desktop-app\src-tauri\target\release\bundle\nsis\Diamond Inventory_1.0.1_x64-setup.exe' `
  -Version '1.0.1'
```

The publisher copies the installer to `frontend/public/downloads`, gives it a stable versioned filename, and regenerates `frontend/src/release.json` with its byte size and SHA-256 checksum. Commit both files and redeploy the static site. Never overwrite a published version with different bytes; increment the version instead.

This release is not code-signed. Windows SmartScreen can show “Windows protected your PC.” Users should select **More info**, verify the app name, and select **Run anyway**. Buy an Authenticode code-signing certificate before broad external distribution.

## Weekly database backup

Supabase recommends regular off-site exports for Free projects because automatic backups are not included. Every Friday, from a trusted workstation with PostgreSQL client tools installed:

```powershell
$stamp = Get-Date -Format 'yyyy-MM-dd'
New-Item -ItemType Directory -Path '.\backups' -Force | Out-Null
$env:PGSSLMODE = 'require'
try {
  pg_dump `
    --host '<SUPABASE_SESSION_POOLER_HOST>' `
    --port 5432 `
    --username 'postgres.<PROJECT_REF>' `
    --password `
    --dbname postgres `
    --format custom `
    --no-owner `
    --no-privileges `
    --file ".\backups\diamond-inventory-$stamp.dump"
} finally {
  Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue
}
Get-FileHash -Algorithm SHA256 ".\backups\diamond-inventory-$stamp.dump" |
  Format-List | Out-File ".\backups\diamond-inventory-$stamp.sha256.txt"
```

Enter the database password only at the prompt. Copy the `.dump` and checksum to encrypted off-site storage with access limited to the owner and the designated backup operator. Keep at least eight weekly copies. Do not commit backups.

## Monthly restore drill

Never test a restore against production. Create an empty temporary Postgres database, then:

```powershell
pg_restore `
  --host '<TEMP_DATABASE_HOST>' `
  --port 5432 `
  --username '<TEMP_DATABASE_USER>' `
  --password `
  --dbname '<EMPTY_TEMP_DATABASE>' `
  --no-owner `
  --no-privileges `
  --exit-on-error `
  '.\backups\diamond-inventory-YYYY-MM-DD.dump'
```

Run the application's table-count checks against the temporary database, sign in with a temporary authorized account, and read stock, requests, tracking, and users. Record the backup date, checksum, restore duration, row counts, and operator. Delete the temporary database through its provider only after the drill passes.

## Capacity and availability checks

Run this query weekly in Supabase SQL Editor:

```sql
select pg_database_size(current_database()) as bytes,
       pg_size_pretty(pg_database_size(current_database())) as readable_size,
       pg_total_relation_size('request_shipping_labels') as label_bytes,
       pg_size_pretty(pg_total_relation_size('request_shipping_labels')) as label_size;
```

- Warn the owner at 400 MB and schedule a paid-plan move. Supabase Free enters read-only mode above the 500 MB database quota.
- Shipping-label PDFs/images are stored in Postgres, not Supabase Storage. Alert at 50 MB of `label_bytes`, review retention before 100 MB, and include this table in every backup/restore drill.
- Check Render's monthly included usage and deployment logs weekly. A free web service has a shared 750-hour workspace allowance and may restart.
- Upgrade the Render API when one-minute cold starts, restarts, or free-tier availability are unacceptable for daily work.
- Upgrade Supabase before 500 MB, before automatic backups become operationally necessary, or when a one-week inactivity pause is unacceptable.

## Rollback and incident response

1. If only the frontend is bad, use Render's rollback to the previous static deployment and leave the API/database unchanged.
2. If the API is bad, roll back the API deployment to the last verified commit. Do not roll back the database unless the migration's documented reverse procedure has been tested.
3. If an installer is bad, remove its download link, restore the previous `release.json` and previous versioned EXE, rebuild the static site, and redeploy. Existing installations continue loading the hosted web app.
4. If credentials may be exposed, rotate the Supabase database password and Render `JWT_SECRET`, update Render, redeploy the API, and invalidate active sessions.
5. Preserve deployment logs, timestamps, checksums, and the last verified backup; never paste credentials into the incident record.

## Release checklist

- Backend tests, frontend tests, Rust tests, desktop configuration tests, and static production build pass.
- Installer SHA-256 matches `frontend/src/release.json` and the deployed download.
- Fresh current-user install creates Start menu and desktop shortcuts, installs `libunwind.dll` and `WebView2Loader.dll` beside the EXE, and launches without requiring Node.js, Rust, or PostgreSQL.
- Login, stock read, request workflow, tracking, rep history, Socket.IO, and upload controls work against production.
- Secrets scan finds no database password, JWT, certificate, or private key in tracked files.
- A current off-site backup exists and the most recent monthly restore drill passed.

## Provider references

- Render Free services: https://render.com/docs/free
- Supabase database size: https://supabase.com/docs/guides/platform/database-size
- Supabase backups: https://supabase.com/docs/guides/platform/backups
- Supabase plan allowances: https://supabase.com/pricing
