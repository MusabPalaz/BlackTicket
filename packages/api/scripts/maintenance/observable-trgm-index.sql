-- Builds the indicator-search index without blocking writes.
--
-- Run this BEFORE `prisma migrate deploy` on an installation that already holds
-- a large observable table. The migration that adds the same index uses
-- IF NOT EXISTS, so once this has run the migration is a no-op.
--
--   psql -d blackticket -f observable-trgm-index.sql
--
-- CONCURRENTLY means writes keep working while the index builds; the cost is
-- that it takes longer and cannot run inside a transaction, which is exactly
-- why it lives here rather than in the migration.
--
-- It is safe to re-run. If a previous attempt was interrupted PostgreSQL leaves
-- an invalid index behind; the DROP below clears that before rebuilding.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DROP INDEX CONCURRENTLY IF EXISTS "observable_normalizedvalue_trgm";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "observable_normalizedvalue_trgm"
  ON "observable" USING gin ("normalizedValue" gin_trgm_ops);

ANALYZE "observable";

SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'observable' AND indexname = 'observable_normalizedvalue_trgm';
