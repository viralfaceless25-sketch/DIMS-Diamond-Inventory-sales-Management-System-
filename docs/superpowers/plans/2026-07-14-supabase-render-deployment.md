# Supabase and Render Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the application deployable to Supabase Postgres and always-on Render services while retaining a local Windows test launcher.

**Architecture:** The existing Express API remains the only database client. A provider-neutral Postgres pool supports Supabase TLS, deployment files supply Render service settings, and a guarded data-copy tool migrates data from CockroachDB to an empty Supabase database without altering the source.

**Tech Stack:** Node.js 24, Express, pg, Next.js 14, Supabase Postgres, Supabase Storage, Render Blueprints, PowerShell.

## Global Constraints

- No database password, JWT secret, certificate, or uploaded document may be committed.
- The migration source database is read-only from the copy tool's perspective.
- The target database must be empty unless `ALLOW_NONEMPTY_TARGET=true` is set deliberately.
- The production backend must reject wildcard CORS and weak/default JWT secrets.
- The frontend must use a public HTTPS API URL in production and preserve hostname-based localhost behavior for LAN testing.

---

### Task 1: Production-safe environment and database configuration

**Files:**
- Modify: `backend/src/db/pool.js`
- Modify: `backend/.env.example`
- Modify: `.gitignore`
- Test: `backend/test/poolConfig.test.js`

**Interfaces:**
- Produces: `buildSslConfig()` accepts `DATABASE_SSL`, `DATABASE_SSL_CA_PATH`, and `DATABASE_PROVIDER`.
- Produces: production startup validation compatible with Supabase and Render.

- [ ] **Step 1: Write failing pool tests for Supabase TLS and unsafe production settings.**
- [ ] **Step 2: Make SSL behavior provider-neutral: Supabase uses trusted TLS, Cockroach can use a pinned CA, and local Postgres may disable TLS only outside production.**
- [ ] **Step 3: Add Supabase-focused environment documentation and ignore all local secrets.**
- [ ] **Step 4: Run `npm.cmd test` from `backend`; expected result: all tests pass.**

### Task 2: Guarded Cockroach-to-Supabase data copy

**Files:**
- Create: `backend/src/db/copyToSupabase.js`
- Modify: `backend/package.json`
- Create: `backend/test/copyToSupabase.test.js`

**Interfaces:**
- Consumes: `SOURCE_DATABASE_URL`, `SUPABASE_DATABASE_URL`, and optional `ALLOW_NONEMPTY_TARGET=true`.
- Produces: `npm run migrate:to-supabase`, which copies tables, verifies counts, resets sequences, and leaves source unchanged.

- [ ] **Step 1: Write failing tests for table ordering, target-empty refusal, and count verification.**
- [ ] **Step 2: Implement the copy tool using two `pg.Pool` clients, a target transaction, parameterized inserts, and a fixed foreign-key table order.**
- [ ] **Step 3: Add a dry-run mode that prints source table counts without writing.**
- [ ] **Step 4: Run `npm.cmd test` from `backend`; expected result: all copy-tool tests pass.**

### Task 3: Render deployment definition and operator documentation

**Files:**
- Modify: `backend/render.yaml`
- Create: `render.yaml`
- Modify: `README.md`
- Create: `docs/SUPABASE_RENDER_GO_LIVE.md`

**Interfaces:**
- Produces: Render Blueprint definitions for backend and frontend, each with explicit health checks and secret placeholders.
- Produces: an operator checklist requiring Supabase credentials only at the final connection step.

- [ ] **Step 1: Define backend and frontend Render services with their correct root directories, build/start commands, and health checks.**
- [ ] **Step 2: Document the exact Supabase dashboard and Render dashboard fields, including expected URLs and verification commands.**
- [ ] **Step 3: Document cutover, rollback, and secret rotation.**

### Task 4: Local testing software and end-to-end verification

**Files:**
- Modify: `desktop/Launch-DiamondInventory.ps1`
- Modify: `desktop/README.md`
- Test: `backend/test/transferService.test.js`

**Interfaces:**
- Produces: `Launch-DiamondInventory.ps1 -OpenApp` for temporary local testing.
- Produces: a production build verified before the local frontend starts.

- [ ] **Step 1: Make the launcher use `npm.cmd` so PowerShell execution policy cannot block it.**
- [ ] **Step 2: Run backend unit tests and the production frontend build.**
- [ ] **Step 3: Start the launcher and verify `/health`, `/ready`, and `/login`.**
