-- Migration 022: Scheduled approval sends (Option D: hybrid manual + scheduled)
--
-- Finance can send an approval email immediately, or queue it to go out at:
--   • The configured daily batch time (e.g. 09:00 Mon-Fri), or
--   • A custom date/time picked per-invoice
--
-- A cron-scheduled edge function (dispatch-scheduled-approvals) runs every
-- 5 minutes and fires emails for any PO whose scheduled_send_at <= now()
-- AND approval_sent_at IS NULL.

-- Per-PO scheduling timestamp. NULL means "send now" (default behaviour).
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMPTZ;

-- Partial index to make the dispatcher cheap — it only scans pending sends.
CREATE INDEX IF NOT EXISTS idx_po_scheduled_pending_send
  ON purchase_orders (scheduled_send_at)
  WHERE scheduled_send_at IS NOT NULL AND approval_sent_at IS NULL;

-- System-wide batch send settings (admins configure these in the Alerts tab).
INSERT INTO system_settings (key, value, description) VALUES
  ('batch_send_time',    '09:00',
    'Default batch send time in 24h HH:MM (Europe/London).'),
  ('batch_send_days',    'mon,tue,wed,thu,fri',
    'Days of the week the default batch slot runs on (comma-separated, lowercase).'),
  ('batch_send_enabled', 'true',
    'Whether the "Send at next batch" option is offered to finance when marking an invoice ready.')
ON CONFLICT (key) DO NOTHING;
