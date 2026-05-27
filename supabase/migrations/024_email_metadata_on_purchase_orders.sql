-- Add email metadata columns to purchase_orders
-- These were previously only stored on invoice_files; duplicating them here
-- avoids a join just to show subject/sender on the dashboard.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_from    TEXT,
  ADD COLUMN IF NOT EXISTS email_date    TIMESTAMPTZ;

-- Backfill from linked invoice_files for all existing rows
UPDATE purchase_orders po
SET
  email_subject = f.email_subject,
  email_from    = f.email_from,
  email_date    = f.email_date
FROM invoice_files f
WHERE po.invoice_file_id = f.id;
