-- 023_mailbox_folder.sql
-- Adds per-mailbox folder configuration so each mailbox can poll a specific
-- MS Graph mail folder (e.g. Inbox\Invoices) instead of always using Inbox.
-- NULL folder_id means "use the default Inbox".

ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS folder_id   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS folder_name TEXT DEFAULT NULL;

COMMENT ON COLUMN mailboxes.folder_id   IS 'MS Graph mail folder ID to poll — NULL means Inbox';
COMMENT ON COLUMN mailboxes.folder_name IS 'Human-readable folder name shown in the Admin Panel — NULL means Inbox';
