-- ── Profile Company Access ─────────────────────────────────────────────────────
-- Stores which companies each finance user is permitted to see.
-- No rows for a user = unrestricted (sees all companies).
-- One or more rows = sees only those companies.
-- Admin and auditor roles always bypass this (handled in RLS).

CREATE TABLE IF NOT EXISTS profile_company_access (
  profile_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company     TEXT        NOT NULL,  -- matches company slug / company_entity enum value
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, company)
);

ALTER TABLE profile_company_access ENABLE ROW LEVEL SECURITY;

-- Admins can read and write all rows
CREATE POLICY "pca_admin_all" ON profile_company_access
  USING (current_user_role() = 'admin');

-- Finance/auditor users can read their own access list
-- (frontend uses this to know which company tabs to show)
CREATE POLICY "pca_own_read" ON profile_company_access
  FOR SELECT USING (profile_id = auth.uid());

-- ── Update purchase_orders RLS ─────────────────────────────────────────────────
-- Replace the blanket finance/admin/auditor policy with a company-scoped one.

DROP POLICY IF EXISTS "po_finance_admin_all" ON purchase_orders;

CREATE POLICY "po_finance_admin_all" ON purchase_orders
  USING (
    -- Admins and auditors: always unrestricted
    current_user_role() IN ('admin', 'auditor')
    OR
    -- Finance: scoped by company access list
    (
      current_user_role() = 'finance'
      AND (
        -- No access rows at all → unrestricted (e.g. senior finance manager)
        NOT EXISTS (
          SELECT 1 FROM profile_company_access WHERE profile_id = auth.uid()
        )
        OR
        -- PO has no company tag → visible to all finance users
        purchase_orders.company IS NULL
        OR
        -- PO company is in this user's permitted list
        EXISTS (
          SELECT 1 FROM profile_company_access
          WHERE profile_id  = auth.uid()
            AND company     = purchase_orders.company::TEXT
        )
      )
    )
  );

-- ── Indexes ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profile_company_access_profile
  ON profile_company_access (profile_id);
