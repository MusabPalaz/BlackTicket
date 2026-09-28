-- Trigram index for indicator search (PLAN.md, Faz 8 load test finding).
--
-- `observables/search` matches with LIKE '%term%', which no btree can serve. A
-- load test at the three-year target measured every search as a parallel
-- sequential scan of two million rows; with this index the same count drops to
-- a bitmap index scan and costs roughly a third of the CPU.
--
-- IF NOT EXISTS is load-bearing, not defensive. Building a GIN index over
-- millions of rows takes minutes and holds a write lock the whole time, which
-- is not acceptable during a deployment. An installation with existing data is
-- expected to build it first, without blocking writes:
--
--   psql -d <db> -f scripts/maintenance/observable-trgm-index.sql
--
-- and this statement then finds it already there and does nothing. A fresh or
-- small installation simply lets the migration create it, which is instant.
-- CREATE INDEX CONCURRENTLY cannot be used here: Prisma runs each migration
-- inside a transaction, and PostgreSQL forbids the concurrent form there.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "observable_normalizedvalue_trgm"
  ON "observable" USING gin ("normalizedValue" gin_trgm_ops);
