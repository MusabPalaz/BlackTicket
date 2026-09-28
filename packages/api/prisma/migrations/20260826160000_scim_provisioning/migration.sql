-- SCIM 2.0 provisioning (PLAN.md, Faz 6.4).
--
-- An OIDC subject and a SCIM externalId are different identifiers for the same
-- person, and a directory issues both, so the SCIM one gets its own column
-- rather than competing for externalId.

-- AlterTable
ALTER TABLE "user" ADD COLUMN "scimExternalId" TEXT;

-- CreateIndex
CREATE INDEX "user_scimExternalId_idx" ON "user"("scimExternalId");
