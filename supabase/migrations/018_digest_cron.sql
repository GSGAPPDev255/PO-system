-- ── Finance Digest: audit action + daily cron ─────────────────────────────────

-- Extend the audit_action enum with digest_sent
-- (dismisses the need for a separate log table)
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'digest_sent';

-- ── Schedule finance-digest daily at 08:30 UTC ────────────────────────────────
-- Runs after reminder-scheduler (08:00) so overdue data is up to date.
SELECT cron.schedule(
  'finance-digest-daily',
  '30 8 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/finance-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := '{}'::jsonb
  );
  $$
);
