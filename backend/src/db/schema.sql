-- Diamond Inventory Management — schema
-- Target: Postgres (Neon free tier or any Postgres 14+)

CREATE TABLE IF NOT EXISTS branches (
  id   TEXT PRIMARY KEY,      -- 'NY' | 'LA' | 'CH'
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_reps (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  branch TEXT NOT NULL REFERENCES branches(id)
);

-- Loose diamonds ("General Client Format")
CREATE TABLE IF NOT EXISTS loose_diamonds (
  barcode        TEXT PRIMARY KEY,
  branch         TEXT NOT NULL REFERENCES branches(id),
  lab            TEXT,
  certificate_no TEXT,
  shape          TEXT,
  carat          NUMERIC(6,2),
  color          TEXT,
  clarity        TEXT,
  cut            TEXT,
  polish         TEXT,
  symmetry       TEXT,
  length_mm      NUMERIC(8,2),
  width_mm       NUMERIC(8,2),
  height_mm      NUMERIC(8,2),
  lw_ratio       NUMERIC(6,3),
  stock_status   TEXT NOT NULL DEFAULT 'available',
  cost           NUMERIC(12,2),   -- internal only, never sent to sales-rep-facing endpoints
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jewelry pieces ("JS Client Format")
CREATE TABLE IF NOT EXISTS jewelry_pieces (
  barcode      TEXT PRIMARY KEY,
  branch       TEXT NOT NULL REFERENCES branches(id),
  img_link     TEXT,
  video_link   TEXT,
  category     TEXT,   -- Ring / Band / Bracelet / Pendant / Earrings
  item         TEXT,   -- description
  ref_no       TEXT,
  metal        TEXT,
  metal_weight NUMERIC(8,2),
  gross_weight NUMERIC(8,2),
  diamond_cts  NUMERIC(8,2),
  diamond_pcs  INTEGER,
  diamond_size TEXT,
  lab          TEXT,
  cert_no      TEXT,
  stock_status TEXT NOT NULL DEFAULT 'available',
  amount       NUMERIC(12,2),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS stock_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS length_mm NUMERIC(8,2);
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS width_mm NUMERIC(8,2);
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS height_mm NUMERIC(8,2);
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS lw_ratio NUMERIC(6,3);
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS snapshot_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE loose_diamonds ADD COLUMN IF NOT EXISTS snapshot_missing_since TIMESTAMPTZ;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS stock_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS img_link TEXT;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS video_link TEXT;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS ref_no TEXT;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS gross_weight NUMERIC(8,2);
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS diamond_size TEXT;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS snapshot_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS snapshot_missing_since TIMESTAMPTZ;

-- A batch of stones requested by a sales rep in one go
CREATE TABLE IF NOT EXISTS requests (
  id            SERIAL PRIMARY KEY,
  sales_rep_id  INTEGER NOT NULL REFERENCES sales_reps(id),
  branch        TEXT NOT NULL REFERENCES branches(id),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'invoice_upload'
  request_scope TEXT NOT NULL DEFAULT 'stone_and_cert', -- stone_and_cert | stone_only | cert_only
  request_type  TEXT NOT NULL DEFAULT 'local', -- urgent | local | ship | dropoff | pickup
  dropoff_company TEXT,
  dropoff_address TEXT,
  status        TEXT NOT NULL DEFAULT 'awaiting' -- awaiting | half_fulfilled | fulfilled (cached, recomputed on every stone change)
);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_scope TEXT NOT NULL DEFAULT 'stone_and_cert';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'local';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS dropoff_company TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS dropoff_address TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fulfillment_branch TEXT REFERENCES branches(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS delivery_branch TEXT REFERENCES branches(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS cross_branch BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS delivery_route TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS paperwork_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS transfer_status TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS resolution_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_confirmed_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_received BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_received_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_receive_requested_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS cancellation_status TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS workflow_version INTEGER NOT NULL DEFAULT 1;

-- Older builds marked a request fulfilled as soon as inventory reviewed its
-- items, which hid unfinished delivery actions from the active queue. Reopen
-- only delivery rows that have not reached a physical terminal state.
UPDATE requests
SET status = 'half_fulfilled'
WHERE status = 'fulfilled'
  AND delivery_route IS NOT NULL
  AND COALESCE(transfer_status, '') NOT IN (
    'handed_to_rep',
    'shipped_to_customer',
    'dropped_off_to_customer'
  );

-- One row per stone inside a request batch
CREATE TABLE IF NOT EXISTS request_stones (
  id             SERIAL PRIMARY KEY,
  request_id     INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  barcode        TEXT NOT NULL,
  item_type      TEXT NOT NULL DEFAULT 'loose', -- 'loose' | 'jewelry'
  stone_found    BOOLEAN NOT NULL DEFAULT false,
  cert_found     BOOLEAN NOT NULL DEFAULT false,
  returned       BOOLEAN NOT NULL DEFAULT false,
  stone_found_at TIMESTAMPTZ,
  cert_found_at  TIMESTAMPTZ,
  returned_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_request_stones_request_id ON request_stones(request_id);
CREATE INDEX IF NOT EXISTS idx_request_stones_barcode ON request_stones(barcode);
CREATE INDEX IF NOT EXISTS idx_requests_branch ON requests(branch);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_fulfillment_branch ON requests(fulfillment_branch);
CREATE INDEX IF NOT EXISTS idx_requests_delivery_branch ON requests(delivery_branch);
CREATE INDEX IF NOT EXISTS idx_requests_cross_branch_status ON requests(cross_branch, transfer_status);
CREATE INDEX IF NOT EXISTS idx_loose_branch ON loose_diamonds(branch);
CREATE INDEX IF NOT EXISTS idx_jewelry_branch ON jewelry_pieces(branch);
CREATE INDEX IF NOT EXISTS idx_loose_active_branch ON loose_diamonds(snapshot_active, branch);
CREATE INDEX IF NOT EXISTS idx_jewelry_active_branch ON jewelry_pieces(snapshot_active, branch);

-- Seed branches (idempotent)
INSERT INTO branches (id, name) VALUES
  ('NY', 'New York'),
  ('LA', 'Los Angeles'),
  ('CH', 'Chicago')
ON CONFLICT (id) DO NOTHING;

-- Auth: sales and inventory staff each have a profile row carrying their
-- display name and home branch. Only role='sales_rep' rows are exposed in
-- sales-rep pickers; inventory profiles scope the default queue branch.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('sales_rep', 'inventory', 'admin')),
  sales_rep_id  INTEGER REFERENCES sales_reps(id),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  token_version INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('sales_rep', 'inventory', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_confirmed_by INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_transfer_received_by INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS erp_receive_requested_by INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id);

CREATE TABLE IF NOT EXISTS stock_recheck_requests (
  id                  BIGSERIAL PRIMARY KEY,
  sales_rep_id        INTEGER NOT NULL REFERENCES sales_reps(id),
  barcode             TEXT NOT NULL,
  item_type           TEXT NOT NULL CHECK (item_type IN ('loose', 'jewelry')),
  home_branch         TEXT NOT NULL REFERENCES branches(id),
  snapshot_status     TEXT,
  snapshot_active     BOOLEAN NOT NULL,
  snapshot_last_seen_at TIMESTAMPTZ,
  state               TEXT NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending', 'verified_available', 'verified_unavailable', 'consumed', 'cancelled')),
  verified_status     TEXT,
  note                TEXT,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at         TIMESTAMPTZ,
  verified_by         INTEGER REFERENCES users(id),
  consumed_at         TIMESTAMPTZ,
  consumed_request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_recheck_one_pending
  ON stock_recheck_requests(sales_rep_id, item_type, barcode)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_stock_recheck_home_queue
  ON stock_recheck_requests(home_branch, state, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_recheck_rep_history
  ON stock_recheck_requests(sales_rep_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS request_paperwork_files (
  request_id    INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  paperwork_type TEXT NOT NULL CHECK (paperwork_type IN ('invoice', 'memo')),
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  file_data     BYTEA NOT NULL,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_shipping_labels (
  request_id INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_data BYTEA NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  ip_address  TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);

CREATE TABLE IF NOT EXISTS stone_movements (
  id               BIGSERIAL PRIMARY KEY,
  request_id       INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  request_stone_id INTEGER NOT NULL REFERENCES request_stones(id) ON DELETE CASCADE,
  sales_rep_id     INTEGER NOT NULL REFERENCES sales_reps(id),
  barcode          TEXT NOT NULL,
  movement_type    TEXT NOT NULL,
  from_branch      TEXT REFERENCES branches(id),
  to_branch        TEXT REFERENCES branches(id),
  actor_id         INTEGER REFERENCES users(id),
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stone_movements_barcode ON stone_movements(barcode);
CREATE INDEX IF NOT EXISTS idx_stone_movements_request ON stone_movements(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stone_movements_rep ON stone_movements(sales_rep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stone_movements_created_at ON stone_movements(created_at DESC);

-- Physical stone/certificate arrivals are independent from source request
-- resolution and from the digital Maitri ERP branch-transfer state.
CREATE TABLE IF NOT EXISTS shipment_receipts (
  id                 BIGSERIAL PRIMARY KEY,
  receiving_branch   TEXT NOT NULL REFERENCES branches(id),
  source_branch      TEXT NOT NULL REFERENCES branches(id),
  request_id         INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  request_stone_id   INTEGER REFERENCES request_stones(id) ON DELETE SET NULL,
  barcode            TEXT NOT NULL,
  stone_received     BOOLEAN NOT NULL,
  cert_received      BOOLEAN NOT NULL,
  match_state        TEXT NOT NULL CHECK (match_state IN ('matched', 'unmatched')),
  received_on        DATE NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by        INTEGER NOT NULL REFERENCES users(id),
  duplicate_override BOOLEAN NOT NULL DEFAULT false,
  workflow_mismatch  JSONB,
  note               TEXT,
  corrected_at       TIMESTAMPTZ,
  corrected_by       INTEGER REFERENCES users(id),
  CHECK (stone_received OR cert_received)
);

CREATE INDEX IF NOT EXISTS idx_shipment_receipts_branch_date
  ON shipment_receipts(receiving_branch, received_on, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_receipts_barcode
  ON shipment_receipts(barcode);
CREATE INDEX IF NOT EXISTS idx_shipment_receipts_request_stone
  ON shipment_receipts(request_stone_id, received_at);
CREATE INDEX IF NOT EXISTS idx_shipment_receipts_unmatched
  ON shipment_receipts(receiving_branch, received_on, received_at DESC)
  WHERE match_state = 'unmatched';
