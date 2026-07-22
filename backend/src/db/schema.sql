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
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS stock_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS img_link TEXT;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS video_link TEXT;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS ref_no TEXT;
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS gross_weight NUMERIC(8,2);
ALTER TABLE jewelry_pieces ADD COLUMN IF NOT EXISTS diamond_size TEXT;

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
