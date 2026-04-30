-- @purpose: Add operation descriptions required by the Stage 6 directories SQL repository.
-- @domain: directories
-- @business_impact: No runtime business behavior changes; this preserves existing operation description payload shape in SQL.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

ALTER TABLE operations
  ADD COLUMN description TEXT NULL AFTER name;
