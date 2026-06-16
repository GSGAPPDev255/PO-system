-- 031: Per-company nominal code (chart of accounts) reference list.
--
-- Finance picks a UniCode on each nominal ledger line; selecting it fills the
-- cost centre (from Acct Code) and department (from Account Name). Each company
-- manages its own list, imported via the Admin panel (CSV), with the UniCode
-- unique within a company.

-- The original (migration 026) nominal_codes table was an unused, empty stub
-- with a different shape. Replace it with the company-scoped reference list.
DROP TABLE IF EXISTS nominal_codes CASCADE;

CREATE TABLE IF NOT EXISTS nominal_codes (
  company       company_entity NOT NULL,
  unicode       text NOT NULL,
  account_name  text,
  acct_code     text,
  cost_centre   text,
  dept          text,
  approver1     text,
  approver2     text,
  in_use        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company, unicode)
);

CREATE INDEX IF NOT EXISTS idx_nominal_codes_company_inuse
  ON nominal_codes (company) WHERE in_use;

ALTER TABLE nominal_codes ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read the list (needed by the picker).
DROP POLICY IF EXISTS nominal_codes_read_auth ON nominal_codes;
CREATE POLICY nominal_codes_read_auth ON nominal_codes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Finance/admin manage the list.
DROP POLICY IF EXISTS nominal_codes_insert_finance ON nominal_codes;
CREATE POLICY nominal_codes_insert_finance ON nominal_codes
  FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['finance'::user_role, 'admin'::user_role]));

DROP POLICY IF EXISTS nominal_codes_update_finance ON nominal_codes;
CREATE POLICY nominal_codes_update_finance ON nominal_codes
  FOR UPDATE USING (current_user_role() = ANY (ARRAY['finance'::user_role, 'admin'::user_role]));

DROP POLICY IF EXISTS nominal_codes_delete_finance ON nominal_codes;
CREATE POLICY nominal_codes_delete_finance ON nominal_codes
  FOR DELETE USING (current_user_role() = ANY (ARRAY['finance'::user_role, 'admin'::user_role]));
