# Maitri Inventory: Supabase and Render Go-Live

This checklist moves the application from the temporary CockroachDB office setup to permanent Supabase and Render services. Do not delete CockroachDB until all cloud acceptance tests pass.

## 1. Create Supabase

1. Create a production Supabase project named `Maitri Inventory` in a US East region.
2. Set a strong database password and store it in the office password manager.
3. Wait until the project is healthy.
4. Click **Connect** and copy the **Session pooler** connection string on port `5432`. This is the correct Supabase connection for a persistent Render backend on an IPv4 network. Never expose it to staff computers.

## 2. Copy the Current Database

1. Open Command Prompt in `C:\Users\zeel1\diamond-inventory\backend`.
2. Create `supabase-copy.env` beside `package.json` from `supabase-copy.env.example`.
3. Set `SOURCE_DATABASE_URL` to the current CockroachDB URL from `backend/.env`.
4. Set `SOURCE_DATABASE_SSL_CA_PATH` to the current Cockroach root certificate path.
5. Set `SUPABASE_DATABASE_URL` to the Supabase Session pooler URL.
6. Run the schema against Supabase once:

```powershell
$env:DATABASE_URL = 'PASTE_SUPABASE_SESSION_POOLER_URL'
$env:DATABASE_PROVIDER = 'supabase'
$env:DATABASE_SSL = 'true'
npm.cmd run migrate
```

7. Run a source-only count check with `DRY_RUN=true`:

```powershell
npm.cmd run migrate:to-supabase
```

8. Set `DRY_RUN=false`, load the values from `supabase-copy.env` into your command environment, then run the copy command once. It refuses a target with existing business data, copies within one transaction, verifies every table count, and resets numeric IDs.

## 3. Deploy Render

1. Push this project to a private GitHub repository. Verify that `.env`, certificates, and `supabase-copy.env` are absent.
2. In Render choose **New +**, then **Blueprint**, and select the repository. Render reads root `render.yaml`.
3. Provide these values when prompted:

| Service | Variable | Value |
|---|---|---|
| `maitri-inventory-api` | `DATABASE_URL` | Supabase Session pooler URL |
| `maitri-inventory-api` | `CORS_ORIGIN` | Actual frontend Render URL |
| `maitri-inventory-web` | `NEXT_PUBLIC_API_URL` | Actual API Render URL |

4. Leave `JWT_SECRET` as Render-generated. Do not reuse the local secret.
5. Use the paid `starter` plan for both services so neither sleeps during the workday.
6. Redeploy the frontend after confirming its API URL.

## 4. Acceptance Test

1. Open `https://YOUR-API-URL/ready`; it must return database `ready`.
2. Log in through the Render frontend with an existing staff account.
3. Compare loose-diamond and jewelry counts to the local app.
4. Submit a local request and verify it appears in inventory live.
5. Run a cross-branch request through pack, ship, receive, confirmation, and handoff.
6. Upload and open a shipping label; confirm shipment is blocked without one.
7. Only after all tests pass, move staff to the Render frontend URL.

## Rollback and Rotation

- If cloud testing fails, use the office app. The copy tool never writes to CockroachDB.
- After acceptance, rotate the current Cockroach password and local JWT secret, then retire Cockroach after the office retention period.
- Keep Supabase and Render owner access in the office password manager.
