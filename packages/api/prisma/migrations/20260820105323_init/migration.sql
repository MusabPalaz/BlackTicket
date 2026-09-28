-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SOC_LEAD', 'ANALYST', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED', 'PENDING_ACTIVATION');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseResolution" AS ENUM ('TRUE_POSITIVE', 'FALSE_POSITIVE', 'BENIGN', 'DUPLICATE', 'INDETERMINATE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Tlp" AS ENUM ('WHITE', 'GREEN', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ObservableType" AS ENUM ('IP', 'DOMAIN', 'URL', 'HASH_MD5', 'HASH_SHA1', 'HASH_SHA256', 'EMAIL', 'USERNAME', 'HOSTNAME', 'FILENAME', 'REGISTRY_KEY', 'MUTEX', 'USER_AGENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseLinkType" AS ENUM ('CORRELATED', 'DUPLICATE', 'RELATED', 'PARENT', 'CHILD');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'TRIAGED', 'IMPORTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ANALYST',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpRecoveryHash" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_history" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policy" (
    "id" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_whitelist" (
    "id" UUID NOT NULL,
    "type" "ObservableType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "isCidr" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correlation_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "case" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW',
    "resolution" "CaseResolution",
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "tlp" "Tlp" NOT NULL DEFAULT 'AMBER',
    "pap" "Tlp" NOT NULL DEFAULT 'AMBER',
    "categoryId" UUID,
    "reporterId" UUID NOT NULL,
    "assigneeId" UUID,
    "sourceSystem" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "slaFirstResponseDueAt" TIMESTAMP(3),
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_task" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" UUID,
    "createdById" UUID NOT NULL,
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_log" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observable" (
    "id" UUID NOT NULL,
    "type" "ObservableType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sightingCount" INTEGER NOT NULL DEFAULT 0,
    "isNoisy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_observable" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "observableId" UUID NOT NULL,
    "isIoc" BOOLEAN NOT NULL DEFAULT false,
    "tlp" "Tlp" NOT NULL DEFAULT 'AMBER',
    "description" TEXT,
    "addedById" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_observable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_link" (
    "id" UUID NOT NULL,
    "sourceCaseId" UUID NOT NULL,
    "targetCaseId" UUID NOT NULL,
    "linkType" "CaseLinkType" NOT NULL DEFAULT 'RELATED',
    "reason" TEXT NOT NULL,
    "observableId" UUID,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mitre_technique" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tactic" TEXT NOT NULL,
    "parentId" TEXT,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mitre_technique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_mitre" (
    "caseId" UUID NOT NULL,
    "techniqueId" TEXT NOT NULL,
    "addedById" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_mitre_pkey" PRIMARY KEY ("caseId","techniqueId")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "categoryId" UUID,
    "rawPayload" JSONB NOT NULL,
    "observables" JSONB NOT NULL DEFAULT '[]',
    "mitre" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "caseId" UUID,
    "apiKeyId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['ingest:write']::TEXT[],
    "createdById" UUID NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorIp" TEXT,
    "actorUserAgent" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_role_status_idx" ON "user"("role", "status");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_tokenHash_key" ON "refresh_token"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_token_userId_revokedAt_idx" ON "refresh_token"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_token_familyId_idx" ON "refresh_token"("familyId");

-- CreateIndex
CREATE INDEX "password_history_userId_createdAt_idx" ON "password_history"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policy_severity_key" ON "sla_policy"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "correlation_whitelist_type_pattern_key" ON "correlation_whitelist"("type", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "case_number_key" ON "case"("number");

-- CreateIndex
CREATE INDEX "case_status_severity_createdAt_idx" ON "case"("status", "severity", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "case_assigneeId_status_idx" ON "case"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "case_reporterId_idx" ON "case"("reporterId");

-- CreateIndex
CREATE INDEX "case_categoryId_idx" ON "case"("categoryId");

-- CreateIndex
CREATE INDEX "case_slaDueAt_idx" ON "case"("slaDueAt");

-- CreateIndex
CREATE INDEX "case_tags_idx" ON "case" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "case_task_caseId_sortOrder_idx" ON "case_task"("caseId", "sortOrder");

-- CreateIndex
CREATE INDEX "case_task_assigneeId_status_idx" ON "case_task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "task_log_taskId_createdAt_idx" ON "task_log"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "observable_sightingCount_idx" ON "observable"("sightingCount" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "observable_type_normalizedValue_key" ON "observable"("type", "normalizedValue");

-- CreateIndex
CREATE INDEX "case_observable_observableId_idx" ON "case_observable"("observableId");

-- CreateIndex
CREATE INDEX "case_observable_caseId_idx" ON "case_observable"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_observable_caseId_observableId_key" ON "case_observable"("caseId", "observableId");

-- CreateIndex
CREATE INDEX "case_link_sourceCaseId_idx" ON "case_link"("sourceCaseId");

-- CreateIndex
CREATE INDEX "case_link_targetCaseId_idx" ON "case_link"("targetCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_link_sourceCaseId_targetCaseId_observableId_key" ON "case_link"("sourceCaseId", "targetCaseId", "observableId");

-- CreateIndex
CREATE INDEX "mitre_technique_tactic_idx" ON "mitre_technique"("tactic");

-- CreateIndex
CREATE INDEX "case_mitre_techniqueId_idx" ON "case_mitre"("techniqueId");

-- CreateIndex
CREATE INDEX "alert_status_receivedAt_idx" ON "alert"("status", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "alert_source_idx" ON "alert"("source");

-- CreateIndex
CREATE UNIQUE INDEX "alert_source_externalId_key" ON "alert"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_keyHash_key" ON "api_key"("keyHash");

-- CreateIndex
CREATE INDEX "api_key_revokedAt_idx" ON "api_key"("revokedAt");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_createdAt_idx" ON "audit_log"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notification_userId_isRead_createdAt_idx" ON "notification"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "job_status_runAt_idx" ON "job"("status", "runAt");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_log" ADD CONSTRAINT "task_log_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "case_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_log" ADD CONSTRAINT "task_log_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_observable" ADD CONSTRAINT "case_observable_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_observable" ADD CONSTRAINT "case_observable_observableId_fkey" FOREIGN KEY ("observableId") REFERENCES "observable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_observable" ADD CONSTRAINT "case_observable_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_link" ADD CONSTRAINT "case_link_sourceCaseId_fkey" FOREIGN KEY ("sourceCaseId") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_link" ADD CONSTRAINT "case_link_targetCaseId_fkey" FOREIGN KEY ("targetCaseId") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_link" ADD CONSTRAINT "case_link_observableId_fkey" FOREIGN KEY ("observableId") REFERENCES "observable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_link" ADD CONSTRAINT "case_link_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_mitre" ADD CONSTRAINT "case_mitre_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_mitre" ADD CONSTRAINT "case_mitre_techniqueId_fkey" FOREIGN KEY ("techniqueId") REFERENCES "mitre_technique"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_mitre" ADD CONSTRAINT "case_mitre_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_key"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
