# Diamond Inventory Windows Installer and Free Cloud Design

## Goal

Deliver one public Windows setup executable that a staff member can download and run on a new Windows 10 or Windows 11 computer. After installation, the user opens Diamond Inventory from the Start menu or desktop and signs in with an existing staff account. The user does not install Node.js, configure a database, copy environment files, or enter a server address.

The launch architecture must cost $0 per month initially. It may later move to paid hosting without replacing the desktop client architecture.

## Approved Architecture

1. Supabase Postgres remains the single shared production database.
2. The existing Express and Socket.io backend runs as one Render Free web service.
3. The Next.js frontend is converted to a static export and runs as a Render Static Site. The static site remains immediately available even when the API sleeps.
4. A Tauri 2 desktop wrapper opens the production HTTPS frontend in a Windows WebView2 window.
5. Render Static Site hosts a public download page and the versioned Windows installer.
6. Browser access remains available at the same frontend URL as a fallback.

## Windows Installer

- Produce the initial NSIS setup executable as `DiamondInventory-Setup-1.0.0.exe`; future releases increment the version in the filename.
- Use per-user installation so ordinary staff computers do not require administrator access for the app itself.
- Create Start menu and desktop shortcuts.
- Configure the installer to download and install the Microsoft WebView2 bootstrapper only if the runtime is missing. Windows 10 and 11 systems that already have WebView2 skip that step.
- Bundle no Node.js runtime, database credentials, API secrets, source database, or local server.
- The first release is unsigned. Windows SmartScreen may require the user to choose **More info** and **Run anyway**.
- Automatic updating is out of scope for the first release. A later version can replace the installer on the download page.

## Frontend and Desktop Security

- All application and API traffic uses HTTPS.
- The production API URL is fixed at frontend build time through `NEXT_PUBLIC_API_URL`.
- The Tauri window loads only the approved production frontend origin.
- Remote web content receives no Tauri filesystem, shell, process, updater, or other privileged capabilities.
- External navigation is not granted desktop privileges.
- JWT-based staff authentication remains required. The public installer and download page do not make inventory data public.
- Database credentials and `JWT_SECRET` remain only in Render environment variables.
- Production CORS allows only the hosted frontend origin.

## Static Frontend Conversion

- Enable Next.js static export and publish its `out` directory.
- Preserve every existing login, admin, inventory, tracking, stock upload, request, transfer, label, and sales-rep workflow.
- Replace the runtime-only `/dashboard/reps/[id]` route with a static-compatible route that reads the rep identifier from a query parameter, while preserving navigation behavior.
- Add a public `/download` page with the current version, Windows requirements, file size, SHA-256 checksum, install instructions, and installer link.
- Keep all API calls and Socket.io connections pointed at the Render API URL.

## Startup and Error Handling

1. The static interface loads immediately when the app starts.
2. If the Render Free API has slept after 15 minutes without HTTP or WebSocket activity, the interface shows a clear **Waking up the inventory server...** state.
3. Readiness checks retry with a bounded delay for up to approximately 90 seconds.
4. The app exposes a manual retry if the API does not become ready.
5. Write requests are never automatically replayed after an ambiguous network failure, preventing duplicate requests or uploads.
6. Once connected, Socket.io supplies real-time updates and active WebSocket messages keep the Render service awake while staff are using it.
7. Inventory is not cached as an offline authoritative copy. The app requires internet access.

## Free-Tier Deployment

### Render

- `maitri-inventory-api`: Node web service on the `free` plan, health check `/ready`.
- `maitri-inventory-web`: static site built from the frontend and served from Render's CDN.
- The API may cold-start after 15 minutes of inactivity. This trade-off is approved for the free launch.

### Supabase

- Continue using the existing Supabase Session Pooler connection.
- The Free plan currently permits a 500 MB database and 1 GB file storage.
- Free projects have no managed automatic backups and may pause after extended inactivity.
- The operator documentation must include size monitoring, an export/backup procedure, and paid-upgrade triggers.

## Public Distribution

- The public static site exposes `/download` without authentication.
- The installer filename is versioned so browsers and CDNs do not serve a stale build.
- The page displays a SHA-256 checksum so the downloaded file can be verified.
- Inventory routes remain protected by existing application authentication even though the frontend assets and installer are public.

## Data Flow

1. The installed Tauri app loads the Render static frontend over HTTPS.
2. The frontend performs an API readiness check.
3. The frontend authenticates with the Render API and stores the issued JWT in its WebView local storage.
4. The API validates authorization and reads or writes Supabase Postgres.
5. Socket.io broadcasts request and stock changes to connected clients.
6. File uploads travel directly from the authenticated client to the API. Secrets never pass to the client.

## Verification and Acceptance

The release is accepted only when all of the following pass:

1. All backend automated tests pass.
2. The frontend production static export succeeds with TypeScript validation.
3. All exported routes and download-page assets resolve.
4. The Render Blueprint validates and contains no secrets.
5. The Tauri production build produces an NSIS `.exe` on Windows.
6. The installed app starts without Node.js, Rust, repository files, or local environment configuration.
7. The installer handles a machine without WebView2 by invoking the official bootstrapper.
8. The deployed `/ready`, `/login`, and `/download` endpoints respond successfully.
9. Login, stock browsing, request creation, request resolution, transfer updates, real-time events, stock upload, and shipping-label upload/open are smoke-tested against the deployed system without destructive data changes.
10. The published installer downloads successfully and its SHA-256 hash matches the value shown on the download page.

## Operational Limits and Upgrade Triggers

- The initial release supports Windows 10 and Windows 11 with internet access.
- API cold starts are expected on the free Render plan.
- Move the API to an always-on paid instance if cold starts disrupt staff work.
- Move Supabase to a paid plan before the database approaches 500 MB, file storage approaches 1 GB, managed backups become business-critical, or free-tier availability is insufficient.
- Code signing should be added when Maitri wants to remove SmartScreen warnings and establish verified publisher identity.

## Out of Scope

- Offline inventory editing or local database replication.
- macOS installers.
- Microsoft Store distribution.
- Automatic desktop updates.
- Replacing the current user roles, passwords, or business workflows.
