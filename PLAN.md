# Black Ticket — SOC Ticket & Case Management Platform

> **Product name:** Black Ticket (`black-ticket`, npm scope: `@black-ticket/*`)
> **Document status:** v2.6 — Phase 8 complete — Phases 0-5, Phase 5.5, Phase 6 (SSO + SCIM) and Phase 7 (outbound e-mail, SMTP + Graph) complete; Phase 8 (hardening) next
> **Date:** 2026-08-26
> **Goal:** A cyber security case management system with TheHive-like simplicity, running on a local network, plus a user/system management (CMS) panel.

---

## 1. Purpose and Scope

### 1.1 Problem
SOC analysts do not record the incidents they resolve (phishing, malware, brute force, data leaks, etc.), or keep them in scattered channels. As a result:
- Nobody notices that the same IOC (IP/hash/domain) was seen on another case before → **lost correlation**
- Case resolution times cannot be measured (no SLA)
- Nobody knows who did what (no audit trail)
- Handover and reporting are manual

### 1.2 Solution
A single web application:
1. **Case (ticket) management** — the analyst opens the case, splits it into tasks, writes notes to the timeline, closes it.
2. **Observable / IOC management** — observables such as IP, hash, domain, URL, e-mail and username are added to every case.
3. **Automatic correlation** — if the same observable appeared on another case, the system immediately warns about a "related case".
4. **Alert ingestion** — the SIEM/EDR sends alerts through a REST API or webhook, and the analyst turns them into cases.
5. **CMS / admin panel** — user lifecycle, roles, system settings, audit records.

### 1.3 Scale Target

| Metric | Start | 3-year target |
|---|---|---|
| Registered users | ~800 | ~2,000 |
| Concurrently active users | ~80–105 | ~250 |
| Cases per year | ~20,000 | ~100,000 |
| Observable records | ~200,000 | ~2,000,000 |
| Ingest (alerts/day) | ~1,000 | ~20,000 |

> These numbers are comfortably handled by a single application server + a single PostgreSQL. The architecture is still built on the **stateless app + external state** principle; if needed, horizontal scaling will require no code change.

---

## 2. Decisions Made

| # | Topic | Decision | Note |
|---|---|---|---|
| D1 | Technology stack | **TypeScript full-stack** — NestJS + React (Vite) | One language, a shared types package |
| D2 | Authentication | **Local accounts** (default), managed from the CMS | The auth layer is pluggable; OIDC/SSO was added in Phase 6 as an **optional feature** — see D10 |
| D3 | Deployment | **For now, development on this machine only** | Docker/production decision in Phase 8 |
| D4 | Correlation | **Observable/IOC-based matching** | Text similarity and alert merge out of scope |
| D5 | Data entry | **Manual form + REST API/webhook ingest** | E-mail and CSV import out of scope |
| D6 | Roles | **Admin / SOC Lead / Analyst / Read-only** + user lifecycle | Team-based data isolation and dynamic custom fields out of scope |
| D7 | Case features | Tasks + timeline/audit, Observable/IOC, MITRE ATT&CK + severity/TLP + SLA | File attachments and PDF reports out of scope |
| D8 | Interface language | **English** | The i18n groundwork is laid, but it starts with a single language |
| D9 | Corporate e-mail domain | The admin enters it in the CMS and **locks** it; while locked, every account must be in that domain | Unlocking is a separate, re-authenticated and audited operation. CSV import (Phase 5) goes through the same validation |
| D10 | Enterprise identity (SSO) | **Generic OIDC relying party**, verified with Entra ID. SSO is a **feature** switched on and off, off by default | Company A wants SSO, company B uses the application as it is today. While `auth.policy.mode = LOCAL`, none of the Phase 6 code comes into play |
| D11 | User provisioning | **JIT + SCIM 2.0** | JIT creates the account at first sign-in; SCIM closes the accounts of people who leave automatically. SCIM authentication uses the existing ApiKey infrastructure (`scim:manage` scope) |
| D12 | Local sign-in while SSO is on | **Break-glass** only (`isRecoveryAccount`) | There must still be a way in during an IdP outage. So `isRecoveryAccount` keeps a local password + TOTP |
| D13 | Outbound e-mail | A mail account in the customer's own domain; **SMTP and Microsoft Graph** | The application has no mail server of its own. M365 keeps SMTP AUTH off by default; those tenants choose Graph. Both transports use the same queue and worker |

### 2.1 Deliberately Out of Scope (v1)
These features **will not be built**, but the data model and architecture are designed not to prevent them:
- File attachments / evidence upload (malware sample handling is a serious security topic, a separate phase)
- PDF report generation
- Opening tickets by e-mail (IMAP)
- Team-based data isolation (multi-tenancy)
- Dynamic custom field definitions
- Threat intel enrichment (VirusTotal, MISP, AbuseIPDB)
- "Similar case" suggestions based on text similarity

---

## 3. Architecture

### 3.1 Component Diagram

```
                    ┌──────────────────────────────────────┐
   Analyst ────────▶│   Web UI (React + Vite + TS)         │
   Admin   ────────▶│   - Case workspace                   │
                    │   - Alert queue                      │
                    │   - Admin/CMS console                │
                    └──────────────┬───────────────────────┘
                                   │ HTTPS  (REST + WebSocket)
                    ┌──────────────▼───────────────────────┐
   SIEM/EDR ───────▶│   API Server (NestJS)                │
   (API key)        │   ┌────────────────────────────────┐ │
                    │   │ auth · users · cases · tasks   │ │
                    │   │ observables · correlation      │ │
                    │   │ ingest · audit · sla · admin   │ │
                    │   └────────────────────────────────┘ │
                    │   Guards: JWT · RBAC · RateLimit     │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────┐
                    │   PostgreSQL 16                      │
                    │   - OLTP tables                      │
                    │   - pg_trgm (search)                 │
                    │   - JSONB (raw alert payload)        │
                    │   - job queue table (v1)             │
                    └──────────────────────────────────────┘
```

### 3.2 Why This Architecture?

**NestJS** — Modular structure (each domain has its own module/service/controller), DI, the guard/interceptor chain, declarative input validation with class-validator, automatic OpenAPI generation. In an enterprise internal application with 800+ users, a framework that "imposes the architecture" is an advantage for maintenance.

**PostgreSQL** — Relational integrity is a must (case ↔ task ↔ observable ↔ user). Also:
- `pg_trgm` + GIN index → fast fuzzy search, no separate Elasticsearch needed
- `JSONB` → the raw alert payload from the SIEM is stored without schema changes
- Partial/composite indexes keep the correlation query in the millisecond range

**NO Redis (v1)** — For 800 users on one server, Redis is extra operational overhead. Instead:
- Session/token → stateless JWT + a refresh token table in the DB
- Rate limiting → in-memory + DB fallback
- Background jobs (SLA checks, bulk correlation) → a simple queue based on PostgreSQL `SKIP LOCKED`

> When moving to horizontal scaling, this will move to Redis + BullMQ; for that reason the job layer is abstracted behind a `JobQueue` interface.

**Prisma ORM** — Type-safe queries, migration management, and a raw SQL escape hatch where needed (to be used for the correlation query).

### 3.3 Monorepo Layout

```
Local-Ticket System/
├─ PLAN.md
├─ README.md
├─ package.json                 # npm workspaces
├─ .env.example
├─ packages/
│  ├─ shared/                   # TS types, enums, zod schemas (shared by client+server)
│  │  ├─ src/enums.ts           # Severity, TLP, CaseStatus, Role, ObservableType
│  │  ├─ src/dto/               # Request/Response types
│  │  └─ src/permissions.ts     # RBAC matrix — single source
│  ├─ api/                      # NestJS
│  │  ├─ prisma/schema.prisma
│  │  ├─ prisma/migrations/
│  │  ├─ prisma/seed.ts
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ app.module.ts
│  │     ├─ common/             # guards, interceptors, filters, decorators
│  │     ├─ modules/
│  │     │  ├─ auth/
│  │     │  ├─ users/
│  │     │  ├─ cases/
│  │     │  ├─ tasks/
│  │     │  ├─ observables/
│  │     │  ├─ correlation/
│  │     │  ├─ alerts/          # ingest + alert queue
│  │     │  ├─ audit/
│  │     │  ├─ sla/
│  │     │  ├─ notifications/   # in-app notifications
│  │     │  └─ admin/           # CMS endpoints
│  │     └─ jobs/               # scheduler + worker
│  └─ web/                      # React + Vite
│     └─ src/
│        ├─ app/                # router, layout, providers
│        ├─ features/           # cases, alerts, observables, admin, auth
│        ├─ components/ui/      # design system
│        ├─ lib/                # api client, hooks, auth store
│        └─ styles/
└─ docs/
   ├─ api.md
   ├─ deployment.md
   └─ adr/                      # architecture decision records
```

---

## 4. Data Model

### 4.1 Entities

**`User`**

| Field | Type | Note |
|---|---|---|
| id | uuid PK | |
| username | citext UNIQUE | sign-in name |
| email | citext UNIQUE | |
| fullName | text | |
| passwordHash | text | Argon2id |
| role | enum | ADMIN / SOC_LEAD / ANALYST / READ_ONLY |
| status | enum | ACTIVE / DISABLED / LOCKED / PENDING_ACTIVATION |
| mustChangePassword | bool | first sign-in / after an admin reset |
| totpSecret | text? | 2FA (optional; an admin can make it mandatory) |
| totpEnabled | bool | |
| failedLoginCount | int | brute-force protection |
| lockedUntil | timestamptz? | |
| lastLoginAt | timestamptz? | |
| createdBy / createdAt / updatedAt | | |
| deletedAt | timestamptz? | soft delete — with 800 people there is no hard delete |

**`Case`** — the central entity of the system

| Field | Type | Note |
|---|---|---|
| id | uuid PK | |
| number | int (sequence) | human-readable: `CASE-2026-000123` |
| title | text | |
| description | text (markdown) | |
| status | enum | NEW / IN_PROGRESS / PENDING / RESOLVED / CLOSED |
| resolution | enum? | TRUE_POSITIVE / FALSE_POSITIVE / BENIGN / DUPLICATE / INDETERMINATE |
| severity | enum | LOW / MEDIUM / HIGH / CRITICAL |
| tlp | enum | WHITE / GREEN / AMBER / RED |
| pap | enum | WHITE / GREEN / AMBER / RED (Permissible Actions Protocol) |
| categoryId | FK | phishing, malware, ddos, insider... (seeded) |
| assigneeId | FK User? | |
| reporterId | FK User | the creator |
| sourceSystem | text? | "Wazuh", "manual", "CrowdStrike" |
| sourceRef | text? | the alert id in the SIEM |
| occurredAt | timestamptz | the moment the incident happened |
| firstResponseAt | timestamptz? | SLA metric |
| resolvedAt / closedAt | timestamptz? | |
| slaDueAt / slaBreached | | computed fields |
| summary | text? | closing summary (required when closing) |
| tags | text[] | GIN index |
| createdAt / updatedAt / deletedAt | | |

**`CaseTask`** — work steps within a case
`id, caseId, title, description, status (TODO/IN_PROGRESS/DONE/CANCELLED), assigneeId?, order, dueAt?, startedAt?, completedAt?, createdBy`

**`TaskLog`** — the analyst's work log (the equivalent of TheHive's "task log")
`id, taskId, authorId, body (markdown), createdAt`

**`Observable`** — a normalised observable (**a single global record**)

| Field | Type | Note |
|---|---|---|
| id | uuid PK | |
| type | enum | IP, DOMAIN, URL, HASH_MD5, HASH_SHA1, HASH_SHA256, EMAIL, USERNAME, HOSTNAME, FILENAME, REGISTRY_KEY, MUTEX, USER_AGENT, OTHER |
| value | text | raw value (as the analyst entered it) |
| normalizedValue | text | lower case, defanging undone, IPv6 compressed |
| firstSeenAt / lastSeenAt | | |
| sightingCount | int | denormalised counter |
| **UNIQUE(type, normalizedValue)** | | the foundation of correlation |

**`CaseObservable`** — the case ↔ observable link (n:n) + case-specific metadata
`id, caseId, observableId, isIoc (bool), tlp, description?, addedById, addedAt` — `UNIQUE(caseId, observableId)`

**`CaseLink`** — a relationship between cases
`id, sourceCaseId, targetCaseId, linkType (CORRELATED/DUPLICATE/RELATED/PARENT/CHILD), reason (text), observableId? (the one that triggered the correlation), createdById?, isAutomatic (bool), createdAt`

**`Alert`** — an ingested raw alert (not yet a case)
`id, externalId, source, title, description, severity, rawPayload (JSONB), observables (JSONB), status (NEW/TRIAGED/IMPORTED/IGNORED), caseId?, apiKeyId, receivedAt` — `UNIQUE(source, externalId)` → idempotency

**`MitreTechnique`** (seeded) and **`CaseMitre`** (n:n)
`techniqueId (T1566.001), name, tactic, url` / `caseId, techniqueId, addedById`

**`AuditLog`** — append-only
`id, actorId?, actorIp, actorUserAgent, action (enum), entityType, entityId, before (JSONB?), after (JSONB?), metadata (JSONB), createdAt`

> UPDATE/DELETE are blocked at database level (rule/trigger). The audit trail cannot be deleted.

**`ApiKey`** — for ingest
`id, name, keyHash (SHA-256), prefix, scopes (text[]), createdById, lastUsedAt, expiresAt?, revokedAt?`

Also: **`RefreshToken`**, **`Notification`**, **`SlaPolicy`**, **`Category`**, **`SystemSetting`**, **`CorrelationWhitelist`**, **`JobQueue`**.

### 4.2 Critical Indexes

```sql
-- The heart of correlation
CREATE UNIQUE INDEX ON observable (type, normalized_value);
CREATE INDEX ON case_observable (observable_id) INCLUDE (case_id, is_ioc);
CREATE INDEX ON case_observable (case_id);

-- Case listing/filtering (the screen analysts use most)
CREATE INDEX ON "case" (status, severity, created_at DESC);
CREATE INDEX ON "case" (assignee_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ON "case" (sla_due_at) WHERE status NOT IN ('RESOLVED', 'CLOSED');

-- Search
CREATE EXTENSION pg_trgm;
CREATE INDEX ON "case" USING GIN (title gin_trgm_ops);
CREATE INDEX ON "case" USING GIN (tags);
CREATE INDEX ON observable USING GIN (normalized_value gin_trgm_ops);

-- Audit
CREATE INDEX ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX ON audit_log (actor_id, created_at DESC);
```

---

## 5. Correlation Engine

### 5.1 Principle

> **If the same observable appears on two different cases, those two cases are related.**

### 5.2 Flow

```
The analyst adds an observable to a case
        │
        ▼
1) NORMALISE
   - trim, lowercase
   - undo defanging: hxxp→http, [.]→., (dot)→.
   - validate IPs (v4/v6), reduce IPv6 to RFC 5952 form
   - Domain: decode punycode, drop the trailing dot
   - URL: lower-case scheme+host, drop the fragment
   - Hash: validate the type from the length (32/40/64)
   - E-mail: keep the local part, lower-case the domain
        │
        ▼
2) UPSERT observable (type, normalizedValue) → a single record
        │
        ▼
3) WHITELIST check
   - The organisation's own IP blocks (10.0.0.0/8, 192.168.0.0/16 ...)
   - High-noise domains such as google.com, microsoft.com
   - If whitelisted, record it but produce no correlation
        │
        ▼
4) MATCH query
   SELECT co.case_id ... WHERE co.observable_id = $1 AND co.case_id <> $2
        │
        ▼
5) Create a CaseLink (isAutomatic = true, linkType = CORRELATED,
   reason = "Shared IP 1.2.3.4")
   - One record, read in both directions by the query
   - If it already exists, do not create a new record; update the hit count
        │
        ▼
6) NOTIFY
   - The "Related Cases (3)" panel on the case page updates live (WebSocket)
   - In-app notification to the case owner and the assignee
```

### 5.3 Performance Safety
- **Fan-out limit:** if an observable appears on more than 50 cases (a "noisy indicator"), no automatic links are created; only a `This indicator appears in 213 cases` badge is shown. Otherwise a single `8.8.8.8` would create thousands of useless links.
- **Bulk adds** (alert import) are resolved in one transaction + one query; no N+1.
- The correlation computation runs **synchronously** (millisecond range); it is queued as a job only for bulk imports.

### 5.4 Presentation to the Analyst

The `Related Cases` panel on the case detail page:

```
CASE-2026-000087  "Phishing — invoice.doc"      Closed / True Positive
  └ shared: 185.220.101.4 (IP), a3f1...9c (SHA256)
CASE-2026-000112  "Suspicious login — EU"       In Progress
  └ shared: 185.220.101.4 (IP)
```

---

## 6. Authorisation (RBAC)

Single source: `packages/shared/src/permissions.ts`. Both the backend guard and the frontend menu visibility are fed from the same matrix.

| Operation | ADMIN | SOC_LEAD | ANALYST | READ_ONLY |
|---|:--:|:--:|:--:|:--:|
| View cases | ✅ | ✅ | ✅ | ✅ |
| Create a case | ✅ | ✅ | ✅ | ❌ |
| Edit own case | ✅ | ✅ | ✅ | ❌ |
| Edit someone else's case | ✅ | ✅ | ❌ | ❌ |
| Assign a case | ✅ | ✅ | ⚠️ self only | ❌ |
| Close a case | ✅ | ✅ | ⚠️ own case | ❌ |
| Delete a case (soft) | ✅ | ❌ | ❌ | ❌ |
| Add / complete tasks | ✅ | ✅ | ✅ | ❌ |
| Add observables / flag IOCs | ✅ | ✅ | ✅ | ❌ |
| Create / remove case links | ✅ | ✅ | ✅ | ❌ |
| View the alert queue | ✅ | ✅ | ✅ | ✅ |
| Alert → case conversion | ✅ | ✅ | ✅ | ❌ |
| Ignore / restore an alert | ✅ | ✅ | ❌ | ❌ |
| Dashboard / metrics | ✅ | ✅ | ✅ | ✅ |
| **User management** | ✅ | ❌ | ❌ | ❌ |
| **Change roles** | ✅ | ❌ | ❌ | ❌ |
| **API key management** | ✅ | ❌ | ❌ | ❌ |
| **View the audit log** | ✅ | ⚠️ read-only | ❌ | ❌ |
| **System settings / SLA policy** | ✅ | ❌ | ❌ | ❌ |
| **Category & whitelist management** | ✅ | ✅ | ❌ | ❌ |

**Rule:** permission checks are **always** done on the backend. Hiding things in the frontend is only UX, not security.

---

## 7. API Surface (v1)

Base: `/api/v1` · Auth: `Authorization: Bearer <access_token>` · Ingest: `X-Api-Key: <key>`

### Auth
```
POST   /auth/login                  { username, password, totpCode? }
POST   /auth/refresh                { refreshToken }
POST   /auth/logout
GET    /auth/me
POST   /auth/change-password
POST   /auth/totp/setup | /enable | /disable
```

### Cases
```
GET    /cases                       ?status&severity&assignee&category&tag&q&from&to&page&size&sort
POST   /cases
GET    /cases/:id
PATCH  /cases/:id
POST   /cases/:id/assign            { userId }
POST   /cases/:id/close             { resolution, summary }
POST   /cases/:id/reopen
DELETE /cases/:id                   (soft, ADMIN)
GET    /cases/:id/timeline          merged activity stream
GET    /cases/:id/related           correlation results
POST   /cases/:id/links             manual linking
DELETE /cases/:id/links/:linkId
```

### Tasks & Logs
```
GET    /cases/:id/tasks
POST   /cases/:id/tasks
PATCH  /tasks/:id
POST   /tasks/:id/logs
GET    /tasks/:id/logs
```

### Observables
```
GET    /cases/:id/observables
POST   /cases/:id/observables       single or bulk: [{ type, value, isIoc, tlp }]
PATCH  /case-observables/:id
DELETE /case-observables/:id
GET    /observables/search          ?q=1.2.3.4 → global search + which cases it appears on
GET    /observables/:id/sightings
```

### MITRE
```
GET    /mitre/techniques            ?q= (autocomplete)
POST   /cases/:id/mitre             { techniqueIds: [] }
DELETE /cases/:id/mitre/:techniqueId
```

### Alerts / Ingest
```
POST   /ingest/alerts               with X-Api-Key, idempotent (source + externalId)
GET    /alerts                      ?status&source
POST   /alerts/:id/import           → creates a new case, carries the observables across
POST   /alerts/:id/merge            { caseId } → adds to an existing case
POST   /alerts/:id/ignore           { reason? } → IGNORED (SOC lead / admin)
POST   /alerts/:id/restore          { reason? } IGNORED → NEW (SOC lead / admin)
```

### Admin / CMS
```
GET    /admin/users                 ?q&role&status&page
POST   /admin/users
POST   /admin/users/bulk            bulk creation from CSV/JSON (the initial load of 800 people)
PATCH  /admin/users/:id
POST   /admin/users/:id/disable | /enable | /reset-password | /force-logout | /reset-2fa
GET    /admin/audit                 ?actor&entity&action&from&to
GET/POST/DELETE /admin/api-keys
GET/PATCH       /admin/settings
GET/POST/PATCH  /admin/categories
GET/POST/DELETE /admin/whitelist    correlation whitelist
GET    /admin/settings/identity-domain          corporate domain policy
PUT    /admin/settings/identity-domain          write/change the primary domain (refused while locked)
POST   /admin/settings/identity-domain/domains          add an additional domain (refused while locked)
DELETE /admin/settings/identity-domain/domains/:domain  remove an additional domain (refused while locked)
POST   /admin/settings/identity-domain/lock     lock (confirmed by typing the domain again)
POST   /admin/settings/identity-domain/unlock   unlock (password + reason, audited)
GET    /admin/stats                 system health
```

### Realtime (WebSocket `/ws`)
`case.created` · `case.updated` · `case.assigned` · `correlation.found` · `alert.received` · `notification.new`

---

## 8. Ingest API Contract

```http
POST /api/v1/ingest/alerts
X-Api-Key: skd_live_a1b2c3...
Content-Type: application/json

{
  "externalId": "wazuh-1029384",
  "source": "Wazuh",
  "title": "Multiple failed SSH logins from external IP",
  "description": "...",
  "severity": "HIGH",
  "occurredAt": "2026-08-20T09:14:22Z",
  "category": "brute-force",
  "observables": [
    { "type": "IP",       "value": "185.220.101.4", "isIoc": true },
    { "type": "USERNAME", "value": "root" },
    { "type": "HOSTNAME", "value": "srv-app-01" }
  ],
  "mitre": ["T1110.001"],
  "raw": { "...": "the SIEM's raw output, stored as is" }
}
```

**Rules:**
- `UNIQUE(source, externalId)` → if the same alert is sent twice, `200 + { duplicate: true }`, no new record is created
- Body limit 512 KB, observable limit 200/alert
- Rate limit per API key: 100 requests/min (configurable)
- Validation error → `422` + a per-field error list
- Every ingest is written to the audit log

---

## 9. Security Design

The application a security team uses cannot itself be the weak link.

| Area | Implementation |
|---|---|
| Password storage | **Argon2id** (m=64MB, t=3, p=4) |
| Password policy | at least 12 characters, weak-password check (zxcvbn), the last 5 passwords cannot be reused |
| Session | Access JWT (15 min) + refresh token (7 days, hashed in the DB, rotating, reuse detection) |
| 2FA | TOTP (RFC 6238), can be made mandatory for the admin role, single-use recovery codes |
| Brute force | 15-minute lock after 5 wrong attempts + per-IP rate limit + audit entry |
| Authorisation | Backend guard on every endpoint; ownership checks in the service layer |
| Input | `class-validator` + `zod` — whitelist mode, unknown fields are refused |
| SQL injection | Prisma parameterised queries; `$1` binding mandatory in raw SQL |
| XSS | React default escaping + **DOMPurify** for markdown rendering; `dangerouslySetInnerHTML` forbidden |
| CSRF | Bearer tokens (no cookies) → no CSRF surface |
| Headers | Helmet: CSP (`default-src 'self'`), HSTS, X-Frame-Options DENY, nosniff |
| CORS | Configured origins only |
| Rate limits | Global 300/min/IP, login 10/min/IP, ingest per key |
| Audit | Every mutation to the AuditLog; the table is append-only (UPDATE/DELETE refused by a DB rule) |
| Logging | Structured JSON (pino); passwords/tokens/secrets are **never** logged (redaction list) |
| Secret management | `.env` (not in the repo) + `.env.example`; JWT secret at least 32 random bytes |
| Dependencies | `npm audit` + automatic updates; a high/critical finding breaks the CI build |
| IDOR | Ownership + role check on every `:id` access; "not found" vs "not allowed" is never leaked |

---

## 10. Frontend Design

### 10.1 Page Map

```
/login                          Sign-in (+ TOTP step)
/                               Dashboard — open cases, SLA risk, my cases, recent alerts
/cases                          Case list — filter bar, saved views, virtual scrolling
/cases/new                      New case form
/cases/:id                      Case workspace
   ├─ Overview                  description, severity/TLP/PAP, MITRE, tags, SLA counter
   ├─ Tasks                     task list + each task's work log
   ├─ Observables               table, IOC toggle, bulk add (paste → automatic parse)
   ├─ Related Cases             correlation panel
   └─ Timeline                  chronological stream of all activity (derived from the audit log)
/alerts                         Alert queue — triage screen, import/merge/ignore/restore
/observables                    Global IOC search
/admin/users                    User management (search, filters, bulk operations)
/admin/users/:id                User detail — role, status, sessions, activity
/admin/api-keys                 API key management
/admin/audit                    Audit records
/admin/settings                 SLA policies, categories, whitelist, system settings
/profile                        Own profile, password, 2FA
```

### 10.2 UX Principles (the simplicity goal)
- **The 3-click rule:** opening a new case is 1 click; adding an observable is paste + Enter.
- **Keyboard first:** `c` new case, `/` search, `a` assign, `Esc` close. The analyst will use them hundreds of times a day.
- **Bulk paste parser:** the analyst pastes a block of text; the system picks out the IPs/hashes/domains in it and guesses their types.
- **Consistent colour coding:** severity and TLP colours follow the standards (TLP:RED red, AMBER orange...).
- **No empty screens:** every list screen tells you "what to do next".
- **Dark mode by default** — SOC screens are usually dark.

### 10.3 Technical
`React 18` + `TypeScript` + `Vite` · `TanStack Query` (server state) + `Zustand` (UI state) · `React Router` · `Tailwind CSS` + `shadcn/ui` · `react-hook-form` + `zod` · `TanStack Table` (virtual scrolling) · `Recharts` (dashboard)

---

## 11. Phase Plan

### Phase 0 — Foundation ✅ *complete*
- [x] Monorepo skeleton, npm workspaces, tsconfig/eslint/prettier
- [x] PostgreSQL 16 installation + role/database + `.env` configuration
- [x] Prisma schema + first migration + seed (admin user, 11 categories, 4 SLA policies, 55 MITRE techniques, whitelist defaults)
- [x] Append-only audit log (verified with a DB rule: UPDATE 0 / DELETE 0)
- [x] NestJS skeleton: health check, global exception filter, pino request logging (secret redaction), Helmet+CSP, rate limiting, OpenAPI
- [x] React skeleton: router, layout, dark theme, API client
- [x] RBAC matrix + 7 unit tests (green)
- **Outcome:** `npm run dev` → web 5173, API 3000, health `ok`, DB `ok`

> **Version notes (learned in Phase 0)**
> - **Prisma 7** is used: `datasource.url` is no longer in the schema but in `packages/api/prisma.config.ts`; `PrismaClient` is built with a driver adapter (`@prisma/adapter-pg`). The connection pool is therefore under our control (`max: 20`).
> - **TypeScript 7** (the native compiler) was deliberately not used; pinned to TS 5.9 for NestJS's `emitDecoratorMetadata` chain.
> - **Argon2**: `@node-rs/argon2` instead of `argon2` — a prebuilt binary that needs no build tools on Windows.
> - `npm audit`: 3 high advisories for `deepmerge-ts`, a dependency of the `prisma` CLI. Only in the development tool chain, not at runtime; waiting for the upstream fix.
> - `prisma migrate dev` is interactive, so it can hang in automation; the CI/production path is `prisma migrate deploy`.

### Phase 1 — Identity and Access ✅ *complete*
- [x] Login / refresh / logout, Argon2id, JWT access + opaque refresh token
- [x] Refresh rotation + **reuse detection** (if a used token is presented again, the whole family is revoked)
- [x] RBAC guard + permission matrix (shared package, single source)
- [x] Brute-force protection: account lockout (5/15 min) + IP×user login rate limit
- [x] TOTP 2FA + single-use recovery codes (the seed is stored encrypted with AES-256-GCM)
- [x] Password policy: at least 12 characters, a zxcvbn guess-count threshold, no reuse of the last 5 passwords
- [x] Mandatory password change guard (with a bootstrap/reset password, no other endpoint can be used)
- [x] AuditLog: login/logout/failed sign-in/lockout/password/2FA/domain/user events
- [x] **Corporate domain policy**: the admin writes it → locks it → it binds every account creation path
- [x] Admin CMS screens: Organisation domain, Accounts (list + create)
- [x] Sign-in screen (two-step TOTP), mandatory password change screen, protected routes, session restore
- **Outcome:** A working identity layer that is role-based, auditable and has a lockable domain

> **Learned / decided in Phase 1**
> - **The password threshold moved from score to guess count.** zxcvbn's 0–4 score is too coarse for a SOC product: measured, `Summer2026!!` scores 3 (10^8 guesses) and `Admin!2026Soc` gets the full score of 4 (10^10) — both are patterns password spraying tries first. The threshold was set to `guessesLog10 >= 12`, and a password containing the account name is refused separately. Under Argon2id (64 MiB), 10^12 guesses is on the order of years per GPU.
> - **Refresh tokens are opaque.** Not JWTs; the database only holds their HMAC keyed with `JWT_REFRESH_SECRET`, so a read-only DB leak is not enough to produce a session.
> - **Access token in memory, refresh token in sessionStorage.** sessionStorage instead of localStorage: on a shared SOC workstation the session dies when the tab closes. The XSS risk was accepted and balanced with rotation + reuse detection.
> - **Single-flight refresh.** When the access token expires and several queries get a 401 at the same moment, if each tried its own rotation, the second would look to the server like a *replay attack*, and the user would be thrown out for being fast.
> - **The TOTP seed is encrypted.** It cannot be hashed (the server has to regenerate the code), so it is stored with AES-256-GCM under `TOTP_ENCRYPTION_KEY` — a DB dump on its own does not yield a working second factor.
> - **The user is read from the DB on every request.** Token claims are not trusted: a disabled account, a demoted role or a forced logout must take effect immediately, not wait for the access token to expire.
> - **`incremental: true` was removed.** Because of the tsbuildinfo produced by `tsc --noEmit`, `nest build` thought everything was "up to date" and produced no output at all.

### Phase 2 — Case Core ✅ *complete*
- [x] Case CRUD + `BT-YYYY-NNNNNN` numbering + a status machine (invalid transitions are refused)
- [x] Closing flow: resolution + a mandatory closing summary; a closed case is read-only; reopening
- [x] Ownership rules (own case / any case) in the service layer
- [x] Assignment: analysts take and release work from the queue; only a lead hands it to someone else
- [x] Tasks + work log (append-only), timestamps derived from status
- [x] Case list: filters (status, severity, assignee, category), search (title/description/tag/number), paging, sorting; filters live in the URL
- [x] Case workspace UI: Overview + Tasks + Timeline tabs
- [x] Severity/TLP/PAP, category, tags, MITRE ATT&CK tagging (picker with search)
- [x] SLA targets derived from severity; the breach verdict is recorded at closing
- [x] Dashboard: open/assigned to me/unassigned/due within 4 hours counters + a queue ordered by deadline
- [x] Timeline: the merged stream of audit entries + tasks + notes (derived, not stored)
- **Outcome:** An analyst can work a real case from start to finish

> **Learned / decided in Phase 2**
> - **Assignment does not follow the ownership rule.** In the first implementation an analyst could only take a case they "owned"; but an unassigned case has no owner, and taking work from the queue is the normal SOC flow. The rule was split: an analyst takes an **unassigned** case and releases their own; moving someone else's case is a lead's right.
> - **The SLA clock runs from when the incident happened**, not when the case was opened. Otherwise a case recorded late would look comfortably within its target.
> - **Task timestamps are not taken from the client**; they are stamped on the server by status, so durations in reports cannot be made up from the interface.
> - **The timeline is derived, not stored** (a merge of audit + tasks + notes) — so it can never drift from the records it describes.
> - **Names, not UUIDs, in the audit log.** Assignment changes used to show two UUIDs; for a stream read at handover the name is written, and the ids stay in the metadata for machine traceability.
> - Closed cases and their tasks cannot be changed; to edit, reopen first.

### Phase 3 — Observables and Correlation ✅ *complete*
- [x] Normalisation library: undoing defanging, IPv4 (octal trap included), IPv6 RFC 5952 compression, punycode domains, URL canonicalisation, hash type validation, e-mail, registry hive expansion — **46 unit tests**
- [x] Observable upsert (`UNIQUE(type, normalizedValue)`) + CaseObservable; the form the analyst typed is stored separately
- [x] Correlation service: a shared indicator links two cases automatically, with bidirectional deduplication
- [x] Fan-out limit (default 50) and whitelist (exact value / IPv4 CIDR / `*.domain`) — noise protection
- [x] CaseLink: automatic correlation + manual linking; when an indicator is removed, the automatic link that loses its reason is removed too
- [x] Related Cases panel (showing which indicator makes them related)
- [x] Global IOC search screen: "have we seen this before?", how many cases it appears on, accepts defanged input
- [x] Bulk paste parser — uses the **same** library in the browser as the API, so the preview can never contradict what is stored
- [x] Admin CMS: Correlation whitelist screen (add/remove rules, fan-out limit information)
- **Outcome:** An IOC seen a second time creates a relationship immediately

> **Learned / decided in Phase 3**
> - **Ambiguous input is refused, not guessed.** `1.2.3.004` is read as octal by some resolvers, so it is *not guaranteed to be the same host* as `1.2.3.4`; merging them would be a guess. In the same way, addresses containing more than one `@` are refused.
> - **My own test caught a security bug:** when `a@b.com` was entered as a DOMAIN, the URL parser treated `a` as user info and silently returned `b.com` — an e-mail address quietly turned into a domain indicator. Every value carrying URL syntax is now refused.
> - **A whitelist rule is not saved unvalidated.** A malformed CIDR silently matches nothing, and the administrator believes they excluded a range. The rule is validated with `isValidIpv4Cidr` as it is written. (The first validation I wrote refused valid CIDRs; I noticed and fixed it before testing.)
> - **The fan-out limit is what keeps correlation usable.** In the test data, the whitelisted `10.10.5.7` appears on 14 cases and produces not a single link — without the protection, that one indicator would tie 14 cases together.
> - **The parser lives in one place.** The bulk paste preview runs in the browser and the save on the server, but both call the same function in `@black-ticket/shared`; the preview and the result cannot diverge.
> - **E2E tests must be rerunnable.** The first Phase 3 script I wrote used fixed indicators, so on its second run it collided with its own data and failed 9 checks. Every run now generates its own IPs/domains/hashes.

### Phase 4 — Alert Ingest and SLA ✅ *complete*
- [x] API key management: generation (plain text shown once), SHA-256 digest, prefix, immediate revocation
- [x] `POST /ingest/alerts` — with `X-Api-Key`, `UNIQUE(source, externalId)` idempotency, per-key per-minute rate limit
- [x] Alert queue UI: filters, detail (raw payload included), **import / merge / ignore**
- [x] Import: the alert becomes a case; indicators, MITRE tags and source information (`sourceSystem`/`sourceRef`) are carried across, and correlation runs immediately
- [x] SLA sweep: a cron running every minute + `POST /admin/sla/sweep` for an admin to trigger by hand
- [x] A breach is **written onto** the case (`slaBreached`), not just passed on as a notification
- [x] First-response delay warning; for unassigned cases it goes to the leads
- [x] In-app notifications: bell, unread counter, single/bulk mark-as-read, deduplication
- [x] Dashboard: alert queue, SLA breaches, awaiting first response, oldest waiting alert
- **Outcome:** A SIEM can be connected, and the process can be measured

> **Learned / decided in Phase 4**
> - **API keys are stored with a fast hash (SHA-256), not Argon2 like passwords.** The key is a high-entropy random value; since it is verified on every ingest request, Argon2 here would mean ~100 ms of CPU per alert with no security gain.
> - **The rate limit is bound to the key, not the IP.** All of a SIEM's alerts come from the same address; the meaningful unit is the integration. A misconfigured integration cannot drown out the others.
> - **An unknown MITRE id does not drop the alert.** The tag is discarded and logged — losing a tag is better than losing a detection. But a malformed body (an alert without a title) is refused.
> - **Notification deduplication is mandatory.** The sweep runs every minute; without protection, a late case would produce a notification every minute until someone touched it, and people would learn to switch notifications off. The window is 24 hours.
> - **30-second polling instead of WebSocket — a deliberate deviation.** `EventSource` cannot carry headers, so the token would have to go in the URL (against our own security rule), and WebSocket would mean a separate authentication handshake and, later, sticky sessions. At this scale (800 users, 30 s) it is a few cheap queries a second; a real-time layer should be addressed together with a broader realtime decision. If wanted, adding it with socket.io is a small job.
> - **The sweep never brings the process down.** Errors are caught and logged, and it retries a minute later; stopping silently would be far worse than logging noisily.

### Phase 5 — CMS / Admin Console ✅ *complete*
- [x] Creating, listing (search + role/status filter), updating and soft-deleting users
- [x] **Bulk CSV import**: dry-run by default, per-row results, temporary passwords, a credentials CSV download
- [x] Password reset (temporary password shown once), disable/enable account, forced logout, **2FA reset** (lost-device recovery)
- [x] Role management + self-lockout protection
- [x] Audit log viewer: action/entity/date filters, per-field diff view, CSV export
- [x] System settings: categories (hidden, never deleted) and SLA targets
- [x] User detail: active session count, last IP, failed sign-in count, open case load, recent activity
- [x] Profile screen: password change and **2FA enrolment with a QR code** (the interface deferred from Phase 1)
- **Outcome:** The admin runs the system without needing a developer

> **Learned / decided in Phase 5**
> - **My test found a real bug in the application:** `AllExceptionsFilter` was dropping the machine-readable `code` field (such as `TOTP_REQUIRED`) from the exception body. The result: when a user with 2FA on signed in, the interface could not move on to the second step and only showed an error — so **2FA sign-in was broken in the interface**. The filter now keeps `code`.
> - **Self-lockout protection.** An admin cannot demote their own role or disable/delete their own account; in addition, operations affecting the last active admin are refused as a second line of defence. Without these rules, a single wrong click could make the system impossible to open without editing the database by hand.
> - **Dry-run by default.** With an 800-row file, "check first" must be the easy thing; the "import for real" button only becomes active after the check has run.
> - **Rows are processed independently.** In an 800-row list, one broken row must not cancel the other 799; each row gets its own result (with its row number).
> - **The CSV parser was written by hand** (9 tests): quoted fields, embedded commas/line breaks, doubled quotes, CRLF, BOM. Keeping a narrow requirement under control was preferred over pulling in a dependency — a parser that silently corrupts row 431 is worse than one that refuses the file.
> - **Categories are hidden, not deleted.** A closed case has to keep the label it was filed under.
> - **Changing an SLA target does not rewrite history**; it only applies to cases opened from then on.

### Phase 5.5 — UI/UX ✅ *complete*
Done before the hardening phase at the user's request; hardening and documentation now work on the final interface.

- [x] **Tag picker**: a suggested tag catalogue (22 definitions, with descriptions), search, keyboard navigation; typed tags stay free-form but are saved to the catalogue (with a usage count), so the "phish/phishing/Phishing" split closes by itself
- [x] **Automatic task playbooks by tag**: when a case is opened, the checklist matching its tags and category is added automatically; every task carries the **question** the analyst will answer
  - *Standard triage* (every case): Log Review, False Positive, Enterprise Search, Containment, Executive Summary
  - *Phishing response*: Header Analysis, Block Sender, Domain Block, Purge, Password Reset
  - *EDR / XDR detection*: Affected User, Affected Host, Insider Threat, IP Block, Disablement, Re-image, Notify constituents (status update), Remove temporary containment measures
  - Another playbook can be added later; applying it again does not create duplicate tasks
  - Playbooks can be edited on the **Admin → Playbooks** screen (SOC Lead rights are enough)
- [x] **Profile menu at the top right**: a circle with initials; the menu shows account information, Profile settings, Change password and a red **Sign out**
- [x] **Notification bell at the top right**, next to the profile; the unread count as a badge
- [x] The application shell was rearranged: top bar + page title, an "Administration" section in the sidebar
- [x] **Editable dashboard**: 11 widgets (area chart, donut, bar, horizontal bar, tables), add/remove/reorder/width, saved per user
- **Outcome:** The analyst starts with questions to answer instead of an empty box; everyone builds their own dashboard

- [x] **Dashboard drill-down**: every chart element leads to the records behind it (bar, slice, day column, SLA row, tag, IOC, ATT&CK technique); the target page shows which filter was applied as a chip, removable with one click
- [x] **Design system**: elevation/shadow, radius, motion and colour tokens; `Button` (4 variants, 2 sizes, loading state), `Select`, `Textarea`, `Card` (title + action area), `PageHeader`, `StatTile`, `Badge`, `Skeleton`, `EmptyState`
- [x] **Toast notifications**: feedback that disappears by itself and is announced with `aria-live`, instead of permanent green strips (error messages stay longer)
- [x] **Loading skeletons** and empty states with actions; tables no longer jump when data arrives
- [x] **Keyboard**: `/` search, `c` new case, `g d/c/a/o` navigation, `?` shortcut help, `Esc` close; a "Skip to content" link and a visible focus ring
- [x] **Global search in the top bar**: if what you type looks like an indicator (IP/hash/domain), it goes to IOC search; otherwise to case search
- [x] **Sidebar**: icons, active indicator, a drawer on narrow screens; the icon set was drawn by hand (one grid, one stroke width)
- [x] **Case list**: preset filters (Open/Mine/Unassigned/Breached/Critical), active filter chips, a left edge colour showing severity, a sticky table header
- [x] **Case tabs in the URL**: the link to the "Related cases" tab can be shared, and the browser back button works

- [x] **Tasks tab redesigned**: a completed task is not struck through; its status is shown by a marker (empty circle / filled dot / green tick / slash); the marker is also a one-click complete button
- [x] **Answers inline**: the "Log" button was removed; answers appear under each question, and you type in the "Answer this question…" field and press **Add** (Ctrl/Cmd+Enter also submits)
- [x] **Progress indicator**: "6 of 13 answered · 4 done" + a bar
- [x] **Timeline is activity only**: who did what, and when; answer texts now live only on the task. Grouped by day, and 13 tasks added at the same moment are collected on one line

> **Learned / decided in Phase 5.5**
> - **Tags must stay free text.** The catalogue suggests but does not lock: an analyst must never be unable to open a case because the right word is not in a list. In return, every typed tag is saved to the catalogue, so today's free text becomes tomorrow's suggestion.
> - **The playbook writes the question into the task's description.** The question is not in a manual but on the screen the analyst works on; that is the difference between a case note saying "handled" and a record that is still useful a month later.
> - **Reapplying does not create duplicates.** When the tags change later, the checklist needs completing; tasks are matched by both `templateItemId` and title and skipped.
> - **Deleting a playbook does not delete the tasks created from it.** The record is the task and its work log, not the template.
> - **The dashboard layout belongs to the user.** A SOC Lead watches SLA and workload, an analyst their own queue; rather than guessing, the layout is stored on the account and travels with the person across machines.
> - **Strikethrough says the wrong thing.** Striking through a completed task reads as "cancelled, never mind" — while the answer underneath is the very record of what happened. Status is now given by a marker, and the text stays readable as it is.
> - **Drawn icons instead of emoji.** Emoji look different on every platform, carry their own colour and sit like patches on a dark surface; the markers were drawn on the same grid and with the same stroke width as the rest of the icon set, and take their colour from their context.
> - **Writing an answer should not require pressing a button first.** The "Log (0)" button became an empty text field under the question: the analyst reads, types, presses **Add**. Answers come with the task (limited to 20 per request), so nothing hides behind a panel.
> - **The timeline and the answers are not the same thing.** The timeline accounts (who did what, when); the answers are the work itself, and they live in one place, under the question they belong to. Putting both in the stream produced two copies of the record.
> - **Simultaneous events on one line.** When a playbook added 13 tasks, the timeline produced 13 lines; now they are collected as "added 13 tasks", with the first four named.
> - **A dashboard number you cannot click is a dead end.** An analyst would see "7 breached" and then have to rebuild that filter by hand. Now every chart element is a link, and the target page says with chips why it shows 12 rows.
> - **The click target on the trend chart is a real element.** I first used chart-level `onClick` + `activeLabel`, but could not verify it: it depended on Recharts' own pointer tracking. A faint full-height column was added for each day — easy to hit and testable.
> - **A drill-down count must match the number of rows in the list.** The trend counted "opened date", while the list filtered by "incident date"; a `dateField` parameter was added. Otherwise the chart would say 5 and the list show 2 rows, and nobody would trust the numbers.
> - **Toasts replaced the permanent strips.** The old behaviour slowly filled the page with stale "saved" messages.
> - **A real bug in the alert queue was fixed**: the merge search state was shared across all alerts; a case chosen for one alert stayed selected when you opened another, creating a risk of merging into the wrong case. The state is now per alert.
> - **Chart colours come from the application's CSS variables.** The CRITICAL bar in a chart and the CRITICAL badge in a table are the same red; charts that invent their own palette force people to read the legend every time.

### Phase 6 — Enterprise Identity: SSO and Automatic Provisioning
Requirement: manage 800 users from one place instead of one by one across separate platforms.

> **The basic rule — this is a feature, not a mode.** Company A turns SSO on, company B uses the application as it is today. `auth.policy.mode` is `LOCAL` by default; in that state none of this phase's code comes into play, and the existing sign-in / CSV import / password policy / TOTP work bit for bit the same. Every sub-step can be delivered on its own.

#### 6.1 — Foundation: schema and setting (no behaviour change)
- [x] `auth.policy` in `system_setting`: `{ mode: 'LOCAL' | 'SSO', oidc, roleMap }`, default `LOCAL`
- [x] Schema: `passwordHash` nullable; `identityProvider`, `externalId`, `externalIssuer`, `provisionedAt`; `@@unique([externalIssuer, externalId])`
- [x] **Every** path reading `passwordHash` gets a null guard: sign-in, `resetPassword`, password history, domain unlock
- **Outcome:** In LOCAL mode the application is exactly the same; the schema is ready to accept SSO

#### 6.2 — Sign-in with OIDC and JIT provisioning
- [x] A relying party with `openid-client`: `/auth/sso/start` (PKCE + state + nonce) → IdP → `/auth/sso/callback`
- [x] The callback issues the **existing** access/refresh tokens — the rest of the application stays unaware of SSO
- [x] Claim mapping: `sub`→`externalId`, `upn`/`preferred_username`→`username`, `email`, `name`→`fullName`
- [x] JIT: the account is created at first sign-in; name/e-mail are refreshed on later sign-ins
- [x] A group→role mapping table; with no match, a default role or refusal
- [x] Admin screen **Single sign-on**: mode, OIDC settings, role mapping, connection test
- **Outcome:** The user signs in with their organisation account, and their account is created by itself

#### 6.3 — Enforcement and break-glass
- [x] With `mode: SSO`, local password sign-in is open only to `isRecoveryAccount` — done together with 6.2: `/auth/sso/status` already said `localSignInAllowed: false`, and the server not enforcing it would have made the interface lie
- [x] Sign-in screen: "Sign in with …" as the main path; the local form under "break-glass sign-in"
- [x] **Decision: unlocking the domain stays behind password verification.** In SSO mode the account that does it is the break-glass account, and that account keeps a local password and cannot be deleted anyway. If an account without a password tries, it gets a message directing it to the break-glass account rather than "wrong password"
- **Outcome:** One way in; during an IdP outage there is still a way into the system

#### 6.4 — Provisioning and deprovisioning with SCIM 2.0
- [x] `/scim/v2/Users` (GET/POST/PUT/PATCH/DELETE) + `ServiceProviderConfig`, `Schemas`, `ResourceTypes`
- [x] Authentication with the existing **ApiKey** infrastructure: a new `scim:manage` scope; `api-key.guard` is used as is
- [x] `active:false` → account `DISABLED`; **no deletion** — cases refer to users
- [x] The recovery account and the last admin cannot be disabled or have their role changed through SCIM
- **Outcome:** When someone leaves, Entra disables them, and the application account closes by itself

> **Phase 6.4 decisions**
> - **SCIM disables, it does not delete.** Even `DELETE /Users/{id}` sets the account to `DISABLED`. Cases are tied to users through `reporterId`/`assigneeId`; deleting the row of someone who left would orphan a year of investigation history. Disabling also revokes the refresh tokens — otherwise the person could keep working until their access token expired.
> - **An account created through SCIM starts at `READ_ONLY`.** Provisioning says "this person exists", not "this person may do this". An account arriving without a role being unable to read anything can be undone; one arriving with access cannot. The real role comes from the group mapping at OIDC sign-in.
> - **The error body must be in SCIM format.** The application's general error filter turned everything into one house format; Entra, however, shows the `detail` field of the body in its provisioning log, and that is the only place an administrator can find out why a user did not sync. The SCIM routes got their own filter.
> - **Key scopes are a real separation.** The ApiKey infrastructure was reused, but without `scim:manage` no ingest key can reach SCIM: an alert feed token able to create accounts would turn the alert pipeline into a way into the directory.
> - **Entra sends `Authorization: Bearer`**, not `X-Api-Key`, and there is no way to change that. The guard accepts both headers.
> - **`"False"` arrives as a string.** Entra writes booleans as strings in PATCH values; outside the spec but universal, and refusing it would mean deactivation never works.

> **Phase 6 decisions**
> - **SSO is a feature, not a mode.** The product serves two kinds of organisation at the same time: one wants enterprise identity, the other uses the application as it is. So SSO is not a global change in behaviour but an addition that leaves no trace while it is off.
> - **Break-glass is not negotiable.** If SSO were the only way in, an IdP outage would make the system completely inaccessible. `isRecoveryAccount` already existed; it stays alive with a local password + TOTP.
> - **`passwordHash` must be nullable.** An SSO user has no local password. Writing an unusable fake hash for everyone would make the field "filled but meaningless" and hide the null guards; the field honestly becomes `String?`.
> - **OIDC does not issue tokens; it gets them issued.** The callback mints the application's own access/refresh tokens. So the guards, the refresh flow, sign-out and authorisation do not change at all — SSO is just "a second way of getting a token".
> - **SCIM disables, it does not delete.** Cases are tied to users through `reporterId`/`assigneeId`; deleting the record of someone who left would break the ownership of past cases.
> - **No new mechanism was written for SCIM authentication.** The ApiKey infrastructure already came with hashed storage, prefix display, revocation and permanent deletion; SCIM adds a scope to it.
> - **Generic OIDC costs almost the same as Entra-specific code.** It will be verified with Entra, but Okta/Google/Keycloak will work too.

### Phase 7 — Outbound E-mail
The installing organisation provides a mail account in its own domain; the application has no mail server of its own.

- [x] A `MailTransport` interface + `SmtpTransport` (nodemailer) **and `GraphTransport`** (Microsoft 365 / Entra, client credentials + `Mail.Send`)
- [x] Settings in `system_setting`; the password encrypted with `secret-box` (`purpose: 'mail'`)
- [x] An `OutboundEmail` table: both the queue and a delivery log the administrator can see
- [x] An `@Cron` worker: `FOR UPDATE SKIP LOCKED`, exponential backoff, 90-day pruning
- [x] `fromAddress` must be inside the organisation domain
- [x] An **Outbound mail** status card on the Organisation domain page + configuration and a test send
- [x] Templates are **operational**: case assigned, SLA breached, alert queue backed up, test
  - The "you were mentioned on a case" template from the plan was not written: the application has no mention feature, and a non-existent event cannot have a template
- **Outcome:** The events the application itself produces reach the user

> **Phase 7 decisions**
> - **The body is not encrypted; it is deleted after sending.** In the first design the body was to be encrypted with `secret-box` because it would carry the temporary password. Once the identity templates were dropped, the only thing it carried was the case title — which is in the database anyway. Instead, the body is set to `NULL` on successful delivery: a second, indefinite copy of case content has no reader, only a retention question.
> - **The queue is also the log.** "Did the suspension notice really go out?" gets asked weeks later; a queue that forgets its own history cannot answer it. Failures are kept as well as successes, and both are pruned after 90 days.
> - **Hooked into the single place where notifications are produced.** `NotificationsService.createMany` already did dedupe and recipient resolution; e-mail was added there as an option with an `email` flag. Scattering mail calls across the services would have meant writing a second copy of the dedupe.
> - **A mail failure does not break the work.** `enqueue` silently does nothing while mail is off, and errors writing to the queue are swallowed: a case assignment must not fail because the mail server is misconfigured.
> - **A time zone bug was caught in testing.** The worker used `now()` in the `FOR UPDATE SKIP LOCKED` query; while Prisma writes `DateTime` as a zone-less `timestamp` in UTC, Postgres `now()` returns local time, so every `runAt` shifted by the server's offset. The result: backoff never worked, and a message used up its 5 attempts within seconds and became `FAILED`. The cut-off is now bound as a parameter.

> **Graph transport (Phase 7 extension)**
> - **The seam paid off.** `GraphTransport` was added; nothing above the `MailTransport` interface — the queue, worker, templates, triggers — changed. Since the settings schema was already a discriminated union, no migration was needed either.
> - **The Graph setting is separate from the OIDC setting.** The same app registration can be used but does not have to be: an organisation can use SSO with Okta and mail with M365. Merging the two would make that setup impossible.
> - **When the transport changes, the old secret is not carried over.** An SMTP password is not a Graph client secret; `buildGraph`/`buildSmtp` only use a previous configuration of the same kind as their default source. Otherwise a credential that could never work would be stored.
> - **`verify()` does not just get a token; it also queries the mailbox.** A token check alone would pass with a mistyped sender address; the first time you would find out would be a queue failing at 3 a.m.
> - **Graph returns 202, with no messageId.** It says it received the message, not that it delivered it. `messageId` stays empty in the log — inventing one would have the log claim a certainty it does not have.
> - **The `Mail.Send` application permission reaches every mailbox in the tenant.** That is why the sender address is fixed in the configuration and not taken from the message.

> **Phase 7 decision — why there are no identity e-mails.** The first design had "welcome + temporary password", "your password was reset" and "2FA was reset" templates. After the SSO decision none of them apply: the IdP manages both the password and MFA, and the application never even sees them. What is left, and what the IdP will never send, is operational notifications; that is where e-mail has lasting value.

### Phase 8 — Hardening and Rollout
- [x] Load testing (800-user scenario, k6) — `packages/api/scripts/load/`

> **Phase 8 — load test results (2026-08-27)**
>
> Dataset: 800 accounts, 100,000 cases, 2,000,000 observables, ~2,000,000 case/observable links (1.4 GB), in a separate `blackticket_loadtest` database. A single API instance, a single PostgreSQL, all on the same machine (10 cores).
>
> | Concurrent analysts | Result |
> |---|---|
> | **40** | All targets met. Case detail p95 22 ms, dashboard 43 ms, IOC search 64 ms, related cases 15 ms, sign-in 250 ms. 0% errors |
> | **100** | Targets not met. Case list p95 4.4 s; detail 3.0 s; dashboard 1.25 s. Still 0% errors — the system does not break, it queues |
>
> **A single instance handles ~40 concurrent analysts.** Since the PLAN §1.3 peak is 80–105, that means either horizontal scaling (the architecture is already stateless) or the fix below.
>
> **Findings**
> - **The case list is the first to give way, and SQL is not the reason.** The queries add up to ~36 ms, the endpoint to 205 ms: the ~170 ms in between is in the Node/Prisma layer. The list uses the *detail* include — for every row it fetches the `category`, `reporter`, `mitre + technique` joins and two separate `_count` aggregations. The list screen shows none of these (only `reference, title, status, severity, assignee, tags, slaDueAt, createdAt`). That is why a single case detail takes 5 ms while the list takes 205 ms.
> - **The connection pool was not the bottleneck.** Raising it from 20 to 50 did not fix the latencies and made IOC search worse. The pool was still made configurable (`DATABASE_POOL_MAX`), because it is the one knob that needs tuning with the deployment.
> - **Observable search does `LIKE '%...%'`**, a query no btree can serve. A `pg_trgm` GIN index turns a parallel full scan into a single-threaded index scan (~3× less CPU). **Added** (migration `20260827120000_observable_trgm_index`): since it is in the schema there is no drift, and since the migration uses `IF NOT EXISTS` it does not lock large installations — there the index is built `CONCURRENTLY` first with `scripts/maintenance/observable-trgm-index.sql`, and the migration finds it and does nothing. `CREATE INDEX CONCURRENTLY` cannot go into the migration itself: Prisma runs every migration inside a transaction, and PostgreSQL forbids the concurrent form there.
> - **The case list optimisation was deliberately not done.** 40 concurrent was judged enough for the current need; since dropping the detail include from the list endpoint would change the shape of the API response, it is held as a separate decision.
> - **PostgreSQL runs with its defaults**: `shared_buffers` 128 MB, against a 1.4 GB dataset. This should go on the rollout checklist.
>
> **A measurement error (for the record).** The first two rounds measured the operating system, not the application: when the target was addressed as `localhost`, Windows tried `::1` first, and since the API only listens on IPv4, every new connection waited ~204 ms. After switching to `127.0.0.1`, IOC search p95 dropped from 15.65 s to 817 ms. The script now uses IPv4, and the reason is written at the top of the file.
- [x] Security review (OWASP ASVS L2) — `docs/security-assessment.md`

> **Phase 8 — ASVS L2 (2026-08-27)**
>
> Done by reading the code, not as a paper checklist. **Two findings, both fixed and verified by running them.**
>
> - **F-1: In-session password verification had no rate limit.** The application does not only verify the password at sign-in — changing the password, turning off 2FA and unlocking the domain verify it too. Because those three sit behind an authenticated session, `LoginThrottleGuard` never saw them, and all that remained was the general 300/min: someone who had taken over a session could try 300 passwords a minute. `ReauthThrottleGuard` was added; it counts per **account, not IP** (if the attacker is already inside the session, their address says nothing). Verification: 13 consecutive wrong attempts → 401×10, 429×3.
> - **F-2: Authorisation denials were not audited.** A 403 was returned but left no trace; someone trying screens their role did not grant left no record behind — exactly the signal the product's customers exist to catch. An `ACCESS_DENIED` entry was added. It is not `await`ed: an authorisation decision must not turn into a 500 because the audit write slowed down. Verification: a READ_ONLY account tried an admin endpoint, got a 403, and the entry was created.
> - **Already solid:** the access token only in memory, refresh in `sessionStorage` (not localStorage); refresh rotation with reuse detection and family-wide revocation; log redaction covering eight fields; no `dangerouslySetInnerHTML` anywhere; mass assignment closed with `forbidNonWhitelisted`; Swagger off in production; CSRF not applicable since no cookies are used.
> - **Accepted risks** are written down with their reasoning: the `deepmerge-ts` advisory is only in the development CLI and its "fix" downgrades prisma; the rate limit counters are in memory (single-instance assumption); case visibility is role-based — deliberate in a SOC.
> - **What was not done is listed explicitly:** penetration testing, container image scanning, DAST, an SSO test against a real Entra tenant. This is a code review, not a penetration test.
- [x] Backup/restore procedure + restore test — `packages/api/scripts/backup/`

> **Phase 8 — backup/restore (2026-08-27)**
>
> - **A dump alone is not enough, and that is the centre of the procedure.** TOTP seeds, the OIDC client secret and the mail password are stored encrypted with `secret-box` in the database; the key is in `.env`, not in the dump. `backup.ps1` leaves a manifest saying so next to every dump, and at the end reminds you to confirm the key is stored separately.
> - **`restore.ps1` writes to a new database by default.** The most common reason to restore is testing that the backups are sound; a rehearsal that overwrites production is not a rehearsal. Targeting the live database needs `-Force`, and it still stops if clients are connected.
> - **The procedure was tried, not just written.** A backup was taken → restored into a separate database → the row counts matched exactly (31 users, 189 cases, 47 observables, 1444 audit entries, 4 API keys, 9 migrations) → the API was started against that database (health 200, wrong password 401) → the encrypted TOTP seeds decrypted with the right key and were refused by AES-GCM with a wrong one.
> - **Dumps are `--format=custom`**, so a single table can be restored without replaying the whole dump; `backup.ps1` checks each dump is readable with `pg_restore --list` right after taking it. You need to learn that a dump is unreadable when it is taken, not during an incident.
> - **A PowerShell trap, for the record:** in SQL passed with `-c`, the double quotes around reserved words such as `"case"`/`"user"` are swallowed by PowerShell and psql reports a syntax error. The verification query is written to a temporary file and run with `-f`.
- [x] Deployment — Docker Compose, `docker/`

> **Phase 8 — deployment (2026-08-27)**
>
> Deployment target: Docker on a Linux server in the organisation's internal network, a static IP + an internal DNS name, added to the organisation's own dashboard **as a link**.
>
> - **One origin.** Caddy terminates TLS and sends `/api/*` to the API and everything else to the static interface. Since the interface already uses the relative path `/api/v1`, CORS never comes into play; `CORS_ORIGINS` is the same host.
> - **The one-shot `migrate` service is why an update cannot corrupt the database.** `prisma migrate deploy` runs and exits, and the API depends on it with `service_completed_successfully`. The schema is never older than the code talking to it. `migrate dev`, `db push` and the seed are not on the image's update path at all.
> - **`update.sh` backs up first.** Prisma has no down-migrations; if a release turns out wrong, the way back is a restore, and a backup taken *after* the migration is no way back.
> - **Backups use the host scheduler, not a sidecar cron.** A backup failing silently in a container nobody watches is worse than none; a systemd timer example is in the documentation.
> - **Debian slim, not Alpine.** `@node-rs/argon2` is a native Rust module and Prisma carries platform-specific engines; both have musl builds, but a password hash that silently fails to load is not worth 40 MB.
> - **Docker licensing:** Engine and Compose are Apache 2.0 and free. Docker Desktop is the paid product, and it is a Mac/Windows developer tool, not used on a server. The organisation pays nothing.
>
> **A bug I caught while writing:** I had written `npm run db:seed` as an installation step; `tsx` is a dev dependency and `npm prune --omit=dev` removes it in the production image, and the seed imports from TypeScript source. The seed is now bundled into a single file with esbuild (`dist/seed.cjs`, 17.5 kb) and runs with plain `node` — tried on an empty database.
>
> **Not testable at the time:** this machine had no Docker, Podman or WSL, so **the images could not be built and run**. The verification was static: the compose YAML parsed, every `COPY` source exists, every env variable compose passes is defined in `env.config.ts`, the four required ones are passed, and `.env.example` covers all 17 variables compose uses.
>
> **Update (2026-09-01): built and run end to end.** Running the stack for the first time found two faults no static check could: `prisma.config.ts` was not copied into the API image, so `prisma migrate deploy` could not learn the connection string (Prisma 7 removed `url` from the schema), and `bookworm-slim` ships without OpenSSL, so Prisma guessed its libssl version. Both were fixed in `Dockerfile.api`. The offline bundle was then installed exactly as a customer would — images loaded from tar, migrate, seed, HTTPS sign-in, backup and `update.sh` all verified.
- [x] Administrator and analyst user documentation — `docs/analyst-guide.md`, `docs/admin-guide.md`

> **Phase 8 — user documentation (2026-08-27)**
>
> - **Two documents, not one.** What an analyst needs to read and what an administrator needs to read are different; merging them into one file would have both searching for their own section.
> - **Screen labels quoted exactly.** Translating or paraphrasing labels would leave the reader unable to find the word they look for on screen; they are quoted verbatim. (The documentation was originally written in Turkish; since the open-source release on 2026-09-28 all repository documentation is English.)
> - **Labels were verified against the code, not written from memory.** Three were wrong and were corrected: editing the dashboard is **`Edit dashboard`**, not `Edit layout`; turning an alert into a case is **`Open case`**, not `Import`; the bulk import buttons are **`Check without importing`** / **`Import for real`**. A wrong label sends the reader looking for something they will not find on screen.
> - **The guides explain what the screen does not say.** Rather than repeating field names, the reasons behind decisions: why the SLA clock starts at the incident time, why an analyst cannot take someone else's case, why the recovery account cannot be deleted, why the directory disables accounts rather than deleting them.
> - **A weekly/monthly operations checklist for administrators** was added; the restore-from-backup rehearsal is there too.
- [x] Data retention policy and archiving

> **Phase 8 — retention and archiving (2026-08-27)**
>
> **The policy is a setting** (`system_setting` → `retention.policy`), not a constant. The classes were split by what the data *is*, not by table: an expired session and a read notification are operational leftovers, while the audit trail is evidence; they cannot share one number.
>
> | Class | Default |
> |---|---|
> | Unfinished SSO sign-in attempt | 7 days |
> | Expired / revoked session | 30 days |
> | Read notification | 90 days |
> | Outbound e-mail log | 90 days |
> | Soft-deleted account/case | **indefinite** |
> | Audit trail | **indefinite** |
>
> - **Two defaults being `null` is deliberate.** How long a security platform should keep its trail is a legal question with a different answer in every organisation; a wrong guess would mean destroying evidence on a timer. The product starting with "delete nothing" is the only responsible default.
> - **A leak was closed.** Nothing cleaned the `sso_login_attempt` table: `SsoService.prune()` was written in Phase 6.2 but never called from anywhere. It is now part of the daily sweep.
> - **Manual clean-up became automatic.** The four targets on the `System health` screen (dead sessions, read notifications, soft-deleted accounts/cases) now also run by themselves at 4 a.m.; the screen stays, because "run it now" is still wanted.
> - **The audit trail is deliberately left out.** The table is append-only at database level and the rule is `DO INSTEAD NOTHING`: a `DELETE` from the application **does not fail — it silently deletes 0 rows**. Measured on the live database — `DELETE 0` although 1292 rows were eligible. Hooking retention up to it would mean a job that reports success forever and does nothing.
> - **Archiving is a separate, privileged operation.** `scripts/maintenance/audit-archive.ps1` first exports to JSONL, verifies the row count, then switches the rule off, deletes and switches it back on inside a single transaction, and finally writes what it did into the trail itself. Its default is a dry run; nothing is deleted without `-Confirm`.
> - **Tried end to end**, without touching live data: backup → restore into a separate database → archive + delete (`DELETE 1292`) → confirmed the rule was switched back on (the next `DELETE` is `DELETE 0` again) → 152 rows + 1 maintenance entry = 153. The `-Database` parameter was added to the script for exactly this rehearsal.

### Phase 9+ — Optional Extensions
SAML 2.0 · File attachments · PDF reports · Threat intel enrichment (MISP/VirusTotal) · Dynamic custom fields · Case templates · Team-based isolation · Tickets by e-mail · Similar case suggestions

---

## 12. Quality and Test Strategy

| Layer | Tool | Coverage target |
|---|---|---|
| Unit | Vitest | Normalisation, correlation, status machine, RBAC → **90%+** |
| Integration | Vitest + a separate test database | Services + real PostgreSQL |
| API (e2e) | Supertest | For every endpoint: happy path + unauthorised access + validation error |
| Frontend | Vitest + Testing Library | Critical flows (sign-in, create case, add observable) |
| E2E | Playwright | 5–6 main scenarios |
| Load | k6 | 800 users / 80 concurrent |

**Mandatory rules:**
- An **unauthorised-role test** is written for every `POST/PATCH/DELETE` endpoint — in a security application this is not negotiable.
- Normalisation functions are also verified with property-based tests.
- CI: lint → typecheck → test → build. No merge while red.

---

## 13. Operations

- **Backups:** daily `pg_dump` + a weekly full backup, 30-day retention; **the restore is tested monthly** (an untested backup is not a backup).
- **Logging:** structured JSON logs, request-id correlation, 90-day retention.
- **Monitoring:** `/health` (liveness) + `/health/ready` (DB check) + `/metrics` (Prometheus format, optional).
- **Migrations:** Prisma migrations only; manual SQL in production is forbidden. Every migration has a rollback plan.
- **Data retention:** closed cases stay in the active table for 2 years, then move to an archive table. Audit log 3 years (adjusted to compliance requirements).
- **Sizing suggestion:** 4 vCPU / 8 GB RAM / 100 GB SSD to start, for a single server.

---

## 14. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Correlation noise (every case gets linked to every other) | Analysts lose trust in the system | Whitelist + fan-out limit + the IOC/observable distinction |
| Normalisation errors | Matches are missed, correlation silently fails | Extensive unit tests + storing the raw value too |
| Analysts not using the system | The project is dead on arrival | UX that brings opening a case down to 30 seconds, bulk paste, keyboard shortcuts |
| The initial load of 800 users | Manual workload | Bulk import in Phase 5 + temporary passwords + a mandatory change at first sign-in |
| Unauthorised access (IDOR) | Case data leaks | A negative authorisation test for every endpoint |
| Tampering with the audit log | Its audit value drops to zero | An append-only constraint at database level |
| Single server failure | The system stops | Backups + a documented restore; if critical, HA is evaluated in Phase 8 |

---

## 15. Decisions Needed for the Next Step

| # | Topic | Decision | Status |
|---|---|---|---|
| Q1 | PostgreSQL | PostgreSQL 16 installed (winget). The dev superuser password is in `.env` and never enters the repository. | ✅ |
| Q2 | Product name | **Black Ticket** — package scope `@black-ticket/*`. Since the project will be used in other environments later, the product name and brand are fed from a single place in the code (`packages/shared/src/branding.ts`). | ✅ |
| Q3 | Git repository | Published on GitHub under AGPL-3.0 on 2026-09-28. | ✅ |
| Q4 | MITRE ATT&CK dataset | A subset of the Enterprise matrix is embedded as seed data (works offline, no internet needed). | ✅ |
| Q5 | Corporate IP blocks | Not embedded in the code — managed on the **Admin CMS → Settings → Correlation Whitelist** screen. The seed only adds the RFC1918 defaults (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8) as editable rows; the admin can remove/add. | ✅ |
| Q6 | SLA durations | First response / resolution: Critical 1h/4h · High 4h/24h · Medium 8h/72h · Low 24h/168h. Can be changed from the Admin CMS. | ✅ |

---

## 16. First Step After Approval

Start with Phase 0: the monorepo skeleton, the Prisma schema and a working `npm run dev`. Every phase ends with a working, demonstrable result; the next phase does not start until the current one is finished.
