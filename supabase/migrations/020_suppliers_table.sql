-- Migration 020: Suppliers master list (Sage 200 supplier codes)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS suppliers (
  code           TEXT PRIMARY KEY,
  short_name     TEXT,
  name           TEXT NOT NULL,
  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  payment_group  TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trigram index for fast substring search on name
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
  ON suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_suppliers_short_name
  ON suppliers (short_name);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read suppliers (picker needs this)
CREATE POLICY "suppliers_read_auth" ON suppliers
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins may modify
CREATE POLICY "suppliers_admin_write" ON suppliers
  USING (current_user_role() = 'admin');
