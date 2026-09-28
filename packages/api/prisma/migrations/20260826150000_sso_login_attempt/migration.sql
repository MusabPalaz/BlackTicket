-- Server-side state for the federated sign-in flow (PLAN.md, Faz 6.2).
--
-- The application keeps no cookies (CORS runs with credentials disabled), so
-- the PKCE verifier and the one-time handoff code live here between the two
-- legs of the flow. Rows are short-lived and swept on a schedule.

-- CreateTable
CREATE TABLE "sso_login_attempt" (
    "id" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "returnTo" TEXT,
    "userId" UUID,
    "handoffHash" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_login_attempt_stateHash_key" ON "sso_login_attempt"("stateHash");
CREATE UNIQUE INDEX "sso_login_attempt_handoffHash_key" ON "sso_login_attempt"("handoffHash");
CREATE INDEX "sso_login_attempt_expiresAt_idx" ON "sso_login_attempt"("expiresAt");

-- AddForeignKey
ALTER TABLE "sso_login_attempt" ADD CONSTRAINT "sso_login_attempt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
