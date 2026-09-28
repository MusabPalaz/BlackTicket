-- Foundation for federated sign-in (PLAN.md, Faz 6.1).
--
-- Additive only: every existing account keeps its password and is recorded as
-- LOCAL, so with auth.policy left at its LOCAL default nothing changes.

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('LOCAL', 'OIDC');

-- AlterTable: an identity-provider account has no local password at all.
ALTER TABLE "user" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "user" ADD COLUMN "identityProvider" "IdentityProvider" NOT NULL DEFAULT 'LOCAL',
                   ADD COLUMN "externalId" TEXT,
                   ADD COLUMN "externalIssuer" TEXT,
                   ADD COLUMN "provisionedAt" TIMESTAMP(3);

-- CreateIndex: one directory subject maps to one account. Existing rows hold
-- (NULL, NULL) and PostgreSQL treats NULLs as distinct, so they do not collide.
CREATE UNIQUE INDEX "user_externalIssuer_externalId_key" ON "user"("externalIssuer", "externalId");
