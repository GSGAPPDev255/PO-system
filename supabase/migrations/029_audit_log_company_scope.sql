-- 029: Scope audit_log reads by company access.
--
-- audit_log is keyed to a purchase order. Previously any finance user could read
-- every PO's audit entries. Under the multi-tenancy model a finance user should
-- only read audit entries for POs in a company they have access to. Admins and
-- auditors continue to see everything.

DROP POLICY IF EXISTS audit_read_finance ON audit_log;

CREATE POLICY audit_read_finance ON audit_log
  FOR SELECT
  USING (
    current_user_role() = ANY (ARRAY['admin'::user_role, 'auditor'::user_role])
    OR (
      current_user_role() = 'finance'::user_role
      AND EXISTS (
        SELECT 1 FROM purchase_orders po
        WHERE po.id = audit_log.purchase_order_id
          AND (
            po.company IS NULL
            OR EXISTS (
              SELECT 1 FROM profile_company_access pca
              WHERE pca.profile_id = auth.uid()
                AND pca.company = (po.company)::text
            )
          )
      )
    )
  );
