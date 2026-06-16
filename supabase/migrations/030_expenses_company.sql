-- 030: Company scoping for expenses.
--
-- Expenses gain a company (chosen by the submitter, editable by finance/admin)
-- so they can be scoped and filtered like invoices. RLS for finance is scoped
-- by profile_company_access; admins/auditors keep full visibility. Staff still
-- see only their own expenses (regardless of company); approvers by assignment.
-- Legacy expenses with a NULL company stay visible to finance until classified.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS company company_entity;

-- Finance read: scope by company access (admins/auditors see all).
DROP POLICY IF EXISTS expenses_finance_select ON expenses;
CREATE POLICY expenses_finance_select ON expenses
  FOR SELECT
  USING (
    current_user_role() = ANY (ARRAY['admin'::user_role, 'auditor'::user_role])
    OR (
      current_user_role() = 'finance'::user_role
      AND (
        company IS NULL
        OR EXISTS (
          SELECT 1 FROM profile_company_access pca
          WHERE pca.profile_id = auth.uid() AND pca.company = (expenses.company)::text
        )
      )
    )
  );

-- Finance update: same company scoping (admins unrestricted).
DROP POLICY IF EXISTS expenses_finance_update ON expenses;
CREATE POLICY expenses_finance_update ON expenses
  FOR UPDATE
  USING (
    current_user_role() = 'admin'::user_role
    OR (
      current_user_role() = 'finance'::user_role
      AND (
        company IS NULL
        OR EXISTS (
          SELECT 1 FROM profile_company_access pca
          WHERE pca.profile_id = auth.uid() AND pca.company = (expenses.company)::text
        )
      )
    )
  );
