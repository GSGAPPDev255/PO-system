-- 027: Scope suppliers per company.
--
-- Each company manages its own supplier list, and supplier codes are unique
-- *within* a company (the same code may exist for two different companies).
--
-- Data tagging (confirmed with finance):
--   * suppliers imported 2026-06-16 (alphanumeric codes) -> Kew House School
--   * suppliers imported 2026-05-26 (8-digit Sage codes)  -> Gardener Schools
--
-- Uniqueness moves from a global PK on (code) to a composite PK on
-- (company, code). Nothing references suppliers.code via FK, so this is safe.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS company company_entity;

UPDATE suppliers SET company = 'kew_house'::company_entity
  WHERE company IS NULL AND created_at::date = '2026-06-16';

UPDATE suppliers SET company = 'gardener_schools'::company_entity
  WHERE company IS NULL AND created_at::date = '2026-05-26';

-- Any remaining untagged rows default to Gardener Schools (the original set).
UPDATE suppliers SET company = 'gardener_schools'::company_entity
  WHERE company IS NULL;

ALTER TABLE suppliers ALTER COLUMN company SET NOT NULL;

-- Swap the primary key: (code) -> (company, code).
ALTER TABLE suppliers DROP CONSTRAINT suppliers_pkey;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (company, code);

-- Helps the per-company picker lookups.
CREATE INDEX IF NOT EXISTS idx_suppliers_company_active
  ON suppliers (company) WHERE is_active;
