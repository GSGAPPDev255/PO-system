-- 028: Multi-tenancy — default-deny company access.
--
-- Previously the purchase_orders RLS let a finance user with *no* access grants
-- see every company ("no rows = see all"). For real departmental separation we
-- switch to least-privilege: a finance user sees a company only if they have a
-- profile_company_access grant for it. Admins/auditors still see everything.
--
-- Existing active finance users were grandfathered with grants to all active
-- companies in the same change set, so no one loses access on rollout.

DROP POLICY IF EXISTS po_finance_admin_all ON purchase_orders;

CREATE POLICY po_finance_admin_all ON purchase_orders
  FOR ALL
  USING (
    current_user_role() = ANY (ARRAY['admin'::user_role, 'auditor'::user_role])
    OR (
      current_user_role() = 'finance'::user_role
      AND (
        company IS NULL
        OR EXISTS (
          SELECT 1 FROM profile_company_access
          WHERE profile_company_access.profile_id = auth.uid()
            AND profile_company_access.company = (purchase_orders.company)::text
        )
      )
    )
  );
