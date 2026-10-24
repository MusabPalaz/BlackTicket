# Black Ticket — OWASP ASVS L2 Assessment

**Date:** 2026-08-27 · **Standard:** OWASP ASVS v4.0.3, Level 2 · **Scope:** API, interface, deployment configuration

L2 was chosen because the application handles sensitive data but is not in the
critical-infrastructure class. The assessment was done by reading the code; two
findings were **fixed and verified by running them**, and the remaining items are
recorded, with their reasoning, as accepted risks or out of scope.

This is not a penetration test. An external team should test it separately before
rollout.

---

## Findings

### F-1 · In-session password verification had no rate limit — **fixed**

*ASVS V2.2.1 (anti-automation)*

The application does not only verify the password at sign-in: changing the password,
turning off two-factor authentication and unlocking the organisation domain verify it
too. Because those three sit behind an authenticated session, `LoginThrottleGuard`
never saw them; all that remained was the general limit of 300/min per IP.

The result: someone who had taken over a session — or a curious insider — could try
300 passwords a minute. Since unlocking the domain is protected only by that
password, the impact was not limited to a single account.

**Fix:** `ReauthThrottleGuard`, applied to all three endpoints. It counts **per
account** rather than per IP — if the attacker is already inside the session, their
address says nothing about how many attempts they made. The limit is
`RATE_LIMIT_REAUTH_PER_MIN` (default 10).

**Verification:** 13 consecutive attempts with a wrong current password → `401 ×10`,
then `429 ×3`.

### F-2 · Authorisation denials were not audited — **fixed**

*ASVS V7.1.3, V7.2.2 (logging of access control failures)*

`PermissionsGuard` returned 403 but left no trace. Someone repeatedly trying screens
their role did not grant left no record behind — exactly the signal the product's
customers exist to catch.

**Fix:** the guard now writes an `ACCESS_DENIED` entry: who, which route, which
permission was missing, which role. The write is not `await`ed; an authorisation
decision must not turn into a 500 because the audit write slowed down.

**Verification:** a READ_ONLY account tried `/admin/settings/retention` → `403`, and in
the audit log
`ACCESS_DENIED | GET /api/v1/admin/settings/retention | MISSING_PERMISSION | READ_ONLY | ["settings:manage"]`.

### Follow-up review · 2026-10-24

A second code review found the items below. All were fixed, and each fix
was checked by running it: unit tests, plus the API against PostgreSQL 16
behind the bundled Caddy configuration, with the interface walked in
Chromium.

| # | Finding | Fix |
|---|---|---|
| F-3 | Twelve advisories in **runtime** dependencies (proxy-addr critical; nodemailer, multer, fast-uri, zod, qs high or moderate), not only the dev-time ones listed below | Patched; nodemailer moved to 10, multer pinned to 2.5 by an override. Two moderate js-yaml advisories remain, below |
| F-4 | Signing out, a forced logout and a password change revoked refresh tokens only; the access token worked until it expired | The access token carries its refresh family (`sid`); the guard refuses it once the family has no live token |
| F-5 | Two concurrent refreshes of one token both succeeded, so reuse detection never fired | Rotation claims the old token with a conditional update in one transaction with its successor; losing the claim counts as reuse |
| F-6 | SCIM could re-enable an account an administrator disabled, move the address of any account (local ones and the break-glass account included) and list the break-glass account. Federated sign-in adopts accounts by address, so moving an address chose who would take an account over | SCIM re-enables only what it disabled (`disabledByDirectory`), changes addresses only on directory-owned accounts, and cannot see the break-glass account |
| F-7 | The interface document had no CSP: helmet's policy only travels on API responses | Caddy sets a policy on the application page (`script-src 'self'`, no plugins, no framing) |
| F-8 | The sign-in limit counted per address *and username*, so spraying one password across a user list met only the global limit; the username was not trimmed, so `" admin"` was a separate allowance | Usernames are normalised as sign-in normalises them, and failed sign-ins are budgeted per address across all usernames (`RATE_LIMIT_LOGIN_FAILURES_PER_IP_PER_MIN`, default 20). A correct password awaiting its second factor does not count |
| F-9 | A TOTP code could be replayed within its ~90-second window; the TOTP-guarded data reset had no per-account limit | The last accepted time step is stored and earlier steps refused; the reset carries the re-authentication limit |
| F-10 | The public readiness probe returned the database driver's error text; the client's `X-Request-Id` was taken as the log id unchecked; an administrator's 2FA reset left sessions open | Generic error, id accepted only if it looks like one, reset signs the account out |

---

## Results by chapter

| # | Chapter | Result | Note |
|---|---|---|---|
| V1 | Architecture and threat modelling | ✅ | Decisions and their reasoning recorded in PLAN.md |
| V2 | Authentication | ✅ | See below |
| V3 | Session management | ✅ | See below |
| V4 | Access control | ✅ | Completed with F-2 |
| V5 | Validation and encoding | ✅ | See below |
| V6 | Stored cryptography | ✅ | AES-256-GCM, HKDF per purpose |
| V7 | Error handling and logging | ✅ | Completed with F-2 |
| V8 | Data protection | ✅ | See below |
| V9 | Communication security | ✅ | TLS + HSTS in the deployment |
| V10 | Malicious code | ⚠️ | Known dependency advisories, below |
| V11 | Business logic | ✅ | Rate limits, assignment and status rules |
| V12 | Files and resources | — | No file upload (deliberately out of scope) |
| V13 | API and web services | ✅ | See below |
| V14 | Configuration | ✅ | See below |

### V2 — Authentication
Argon2id (64 MiB, t=3, p=4). Password strength is measured by **zxcvbn guess count**
(10¹²), not by length: `Summer2026!!` and `Admin!2026Soc` are refused, real passwords
pass. Password history is kept. 15-minute lockout after 5 wrong attempts. TOTP as the
second factor, with encrypted seeds. Temporary passwords must be changed at first
sign-in. There is **no** self-service password reset — deliberately: the most commonly
abused flow simply does not exist.

### V3 — Session management
The access token lives **only in memory**; it is never written to any storage, is lost
on page reload, and XSS cannot read it. The refresh token is in `sessionStorage` (not
localStorage) — it dies with the tab. Refresh rotation has **reuse detection**: if the
same token is presented twice, the whole family is revoked and the event is recorded.
Signing out revokes the session. The access token carries its refresh
family, and the guard refuses it as soon as that family is revoked: signing
out, a forced logout or a password change ends it at once, not when it
expires.

### V5 — Validation and encoding
A global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`: a field outside
the contract is not silently dropped, the request is refused — mass assignment is
closed. Prisma produces parameterised queries; the two raw SQL statements
(`mail.worker`, `relatedCount`) use tagged templates, so they are parameterised too.
There is **no** `dangerouslySetInnerHTML` anywhere in the interface. CSP
`script-src 'self'`, set by helmet on API responses and by Caddy on the
application page itself.

### V8 — Data protection
Encrypted secrets: TOTP seeds, the OIDC client secret, the mail password. The key is
in the environment, not in the database. **Logs are redacted**: the `authorization`,
`x-api-key`, `cookie`, `password`, `currentPassword`, `newPassword`, `totpCode` and
`refreshToken` fields never reach the log. The SSO handoff code appears in the URL,
but it is **single-use and valid for 60 seconds**; once consumed it is worthless, and
the interface removes it from the address bar. It is also **bound to the browser that
started the sign-in** (an HttpOnly `__Host-` cookie, checked on the provider's callback
and on the exchange), so a link to someone else's half-finished sign-in signs nobody
in.

### V13 — API
JSON only. CORS `credentials: false` and a single origin in the deployment — **CSRF is
not applicable** (no session cookies; bearer tokens). The one cookie, the SSO sign-in
binding above, authenticates nothing on its own: it only proves a sign-in leg came
from the browser that began it. Machine endpoints are protected by API
keys with **scope** separation: a key that submits alerts cannot create accounts.
SCIM has its own rate limit.

### V14 — Configuration
Secrets are in environment variables, not in the code. They are validated with zod at
boot; a short JWT secret stops the process from starting. Swagger is **off in
production**. helmet sets CSP, `frameAncestors 'none'`, `X-Content-Type-Options`,
`Referrer-Policy`. The container runs as a non-root user.

---

## Accepted risks

**Dependency advisories (V10).** `npm audit --omit=dev` reports two moderate
advisories, both js-yaml under `@nestjs/swagger`. js-yaml only builds the API
documentation, which is switched off in production. The fixed swagger release
needs NestJS 12, so it closes with that migration. The earlier `deepmerge-ts` →
`prisma` advisories were closed by the Prisma 7.10 update.

**In-memory rate limits.** The sign-in (per address and username, and failed
sign-ins per address) and re-authentication counters live in process memory. On a single instance they are exact; with several instances they become
per-instance, and the database-backed account lockout remains the one hard limit.
Acceptable for the target of 800 users on a single server.

**Case visibility is role-based, not ownership-based.** Everyone with `CASE_READ` can
read every case. In a SOC product this is a deliberate design: an analyst being able
to answer "have we seen this before?" is what the whole of correlation rests on.
Team-based isolation is explicitly out of scope for v1 in PLAN.md.

**The administrator sees the temporary password on reset.** It is shown once on
screen, and changing it at first sign-in is mandatory. For organisations that move to
SSO this flow is disabled anyway.

---

## Not done

- **Penetration testing.** This is a code review. An external team should test before
  rollout.
- **Dependency supply-chain review** (SBOM, signature verification).
- **Container image scanning.** The deployment images have since been built and run
  end to end, but not scanned; scan them with `trivy` or equivalent.
- **DAST / fuzzing.**
- **A real SSO test against an identity provider.** The OIDC flow was verified
  against a local test tenant; it has not been tried with a real Entra tenant.
