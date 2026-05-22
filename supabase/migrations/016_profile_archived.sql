-- ── Profile Archived ──────────────────────────────────────────────────────────
-- Archived users are hidden from the default Users tab view and cannot sign in.
-- Used for leavers — keeps them in the DB for audit purposes but out of the way.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Archived users are always inactive too (enforced by trigger)
CREATE OR REPLACE FUNCTION enforce_archived_inactive()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_archived = TRUE THEN
    NEW.is_active = FALSE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_archived_forces_inactive
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_archived_inactive();

CREATE INDEX IF NOT EXISTS idx_profiles_archived ON profiles (is_archived);
