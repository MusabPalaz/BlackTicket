-- Database-level guarantees that the application layer cannot provide on its own.
-- Appended to the initial Prisma migration; kept here as the readable source.

-- 1. Trigram search ---------------------------------------------------------
-- Powers case title and observable value search without a separate search
-- engine. `pg_trgm` itself is declared in schema.prisma; the indexes are not
-- expressible in Prisma schema syntax.
CREATE INDEX IF NOT EXISTS "case_title_trgm_idx"
  ON "case" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "observable_normalized_value_trgm_idx"
  ON "observable" USING GIN ("normalizedValue" gin_trgm_ops);

-- 2. Partial index for open-case SLA sweeps ---------------------------------
-- The SLA job only ever scans cases that are still running, so the index only
-- carries those rows.
CREATE INDEX IF NOT EXISTS "case_open_sla_idx"
  ON "case" ("slaDueAt")
  WHERE "status" NOT IN ('RESOLVED', 'CLOSED') AND "deletedAt" IS NULL;

-- 3. Append-only audit log --------------------------------------------------
-- An audit trail that the application can rewrite is not an audit trail. These
-- rules make UPDATE and DELETE no-ops for every role, including the account the
-- API connects with. Corrections are made by inserting a new record.
--
-- Retention (deleting rows older than the retention window) is therefore a
-- privileged, deliberate operation: a superuser must ALTER TABLE ... DISABLE
-- RULE, prune, and re-enable it.
CREATE OR REPLACE RULE "audit_log_no_update" AS
  ON UPDATE TO "audit_log" DO INSTEAD NOTHING;

CREATE OR REPLACE RULE "audit_log_no_delete" AS
  ON DELETE TO "audit_log" DO INSTEAD NOTHING;
