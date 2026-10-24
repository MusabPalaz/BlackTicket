-- Who switched an account off: the directory over SCIM, or an administrator
-- here.
--
-- SCIM may turn back on what SCIM turned off, but not what an administrator
-- disabled in Black Ticket. Without remembering the source, a directory sync
-- still listing the person would quietly undo a local decision.

-- AlterTable
ALTER TABLE "user" ADD COLUMN "disabledByDirectory" BOOLEAN NOT NULL DEFAULT false;
