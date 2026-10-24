-- The last TOTP time step an account signed in with.
--
-- A code stays valid for its whole tolerance window, about a minute and a
-- half. Remembering the step it was spent at lets the same code, read over a
-- shoulder or out of a phishing page, be refused the second time.

-- AlterTable
ALTER TABLE "user" ADD COLUMN "totpLastStep" INTEGER;
