-- Content hash for duplicate detection — SHA-256 hex of the raw file bytes.
-- Allows us to detect identical invoices regardless of filename or sender.
ALTER TABLE invoice_files
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_invoice_files_file_hash ON invoice_files (file_hash)
  WHERE file_hash IS NOT NULL;
