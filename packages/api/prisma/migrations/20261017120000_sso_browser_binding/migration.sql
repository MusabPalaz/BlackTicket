-- Ties a federated sign-in to the browser that started it.
--
-- Nullable so the migration applies to a live table: a row from before this
-- column existed simply fails the check and the person signs in again.

-- AlterTable
ALTER TABLE "sso_login_attempt" ADD COLUMN "bindingHash" TEXT;
