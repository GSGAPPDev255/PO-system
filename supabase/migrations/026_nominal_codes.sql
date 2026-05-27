-- Migration 026: Nominal codes master list
-- Stores Sage 200 nominal account codes used to populate cost centre / department
-- dropdowns on the invoice review form.

CREATE TABLE IF NOT EXISTS nominal_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,        -- Sage nominal account number, e.g. "5001"
  name        TEXT NOT NULL,        -- Human-readable description
  cost_centre TEXT,                 -- Default cost centre for this code, e.g. "HB"
  department  TEXT,                 -- Default department code, e.g. "01"
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nominal_codes_code_uidx ON nominal_codes (code);

CREATE TRIGGER trg_nominal_codes_updated_at
  BEFORE UPDATE ON nominal_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE nominal_codes ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed for invoice-review dropdowns)
CREATE POLICY "nominal_codes_read_auth" ON nominal_codes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins can insert
CREATE POLICY "nominal_codes_admin_insert" ON nominal_codes
  FOR INSERT WITH CHECK (current_user_role() = 'admin');

-- Only admins can update (deactivate / rename)
CREATE POLICY "nominal_codes_admin_update" ON nominal_codes
  FOR UPDATE USING (current_user_role() = 'admin');

-- Only admins can delete
CREATE POLICY "nominal_codes_admin_delete" ON nominal_codes
  FOR DELETE USING (current_user_role() = 'admin');
