# Supabase and Render Deployment Design

## Goal

Move Maitri Diamond Inventory from the temporary CockroachDB-backed office setup to a permanent Supabase Postgres database, with an always-on Render backend and a Render-hosted frontend. Keep the existing Windows launcher available for local testing until the cloud launch is accepted.

## Approved Architecture

1. Supabase Postgres is the sole production database.
2. Supabase Storage is reserved for shipping labels and future invoice/memo documents. Existing shipping-label database storage remains readable during transition.
3. Render hosts two always-on Node services: the Express/Socket.io backend and the Next.js frontend.
4. The frontend communicates only with the backend. Browser clients never receive database credentials.
5. The office Windows launcher remains a temporary local test option using `localhost:3000` and `localhost:4000`.

## Data Migration

1. Create an empty Supabase project and obtain its direct Postgres connection string.
2. Run the existing schema migration against Supabase.
3. Run a dedicated copy script with the current Cockroach connection as source and Supabase as destination.
4. The script copies all application tables in foreign-key order inside a transaction, verifies row counts, resets identity sequences, and rolls back target writes if any table copy fails.
5. No current Cockroach data is modified by the copy process. Cockroach remains the rollback database until acceptance testing is complete.

## Configuration and Security

- Production secrets live only in Render environment variables. They are never committed.
- `.env`, certificates, exported database dumps, and uploaded documents are ignored by Git.
- Supabase uses TLS with `DATABASE_SSL=true`; Render uses the standard Supabase CA trust chain and does not require a local certificate file.
- Render CORS is restricted to the deployed frontend URL. Local testing may use an explicit comma-separated allowlist.
- Existing Cockroach database credentials and the current JWT secret must be rotated after cutover because they were present in a local development `.env`.

## Deployment and Operations

- Render blueprints define the backend and frontend services, their health checks, build commands, and secret environment variable names.
- Backend readiness verifies database access through `/ready`; frontend health uses `/login`.
- A Windows PowerShell launch script starts local testing only. It does not alter the cloud system.
- Deployment documentation gives one ordered checklist: create Supabase, set Render variables, migrate, import data, seed only missing users, deploy, test, then switch staff to the Render URL.

## Acceptance Tests

1. Backend starts with a Supabase-style TLS connection string.
2. Schema migration is idempotent.
3. Data copy refuses a non-empty target unless explicitly permitted.
4. Data copy verifies source and destination row counts for every copied table.
5. Render configuration parses and contains no secrets.
6. Production frontend build and backend tests pass.
7. The deployed frontend can log in, load stock, submit a request, update a transfer, and receive real-time request updates.
