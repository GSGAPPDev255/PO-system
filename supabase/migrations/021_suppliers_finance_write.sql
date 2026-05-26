-- Migration 021: Allow finance + admin to insert, update, and delete suppliers
-- Previously only admins could write. Finance need to add and remove suppliers
-- directly from the invoice review picker.

-- Drop the blanket admin-only write policy
DROP POLICY IF EXISTS "suppliers_admin_write" ON suppliers;

-- Finance and admin can INSERT new suppliers
CREATE POLICY "suppliers_finance_insert" ON suppliers
  FOR INSERT WITH CHECK (current_user_role() IN ('finance', 'admin'));

-- Finance and admin can UPDATE existing suppliers
CREATE POLICY "suppliers_finance_update" ON suppliers
  FOR UPDATE USING (current_user_role() IN ('finance', 'admin'));

-- Finance and admin can DELETE suppliers
CREATE POLICY "suppliers_finance_delete" ON suppliers
  FOR DELETE USING (current_user_role() IN ('finance', 'admin'));
