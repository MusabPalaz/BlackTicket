-- Outbound e-mail queue and delivery record (PLAN.md, Faz 7).

-- CreateEnum
CREATE TYPE "OutboundEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "outbound_email" (
    "id" UUID NOT NULL,
    "to" TEXT NOT NULL,
    "userId" UUID,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT,
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "messageId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_email_status_runAt_idx" ON "outbound_email"("status", "runAt");
CREATE INDEX "outbound_email_createdAt_idx" ON "outbound_email"("createdAt");

-- AddForeignKey
ALTER TABLE "outbound_email" ADD CONSTRAINT "outbound_email_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
