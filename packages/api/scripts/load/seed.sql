-- Load-test dataset: PLAN.md §1.3 three-year target.
--
--   800 accounts, 100k cases, 2M indicators, ~2M case/indicator links.
--
-- Run against a database created for the purpose and nothing else:
--
--   createdb blackticket_loadtest
--   DATABASE_URL=...blackticket_loadtest npx prisma migrate deploy
--   psql -d blackticket_loadtest -f seed.sql
--
-- Every account gets the same password hash. That is deliberate: hashing 800
-- passwords with Argon2id at 64 MiB would take a minute and prove nothing, and
-- the load test needs one password it can sign in with.
-- Password: loadtest-harbor-quartz-97
\set ON_ERROR_STOP on
\timing on

INSERT INTO "user" (id, username, email, "fullName", "passwordHash", role, status,
                    "mustChangePassword", "identityProvider", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
       'load' || i,
       'load' || i || '@blackticket.local',
       'Load Tester ' || i,
       '$argon2id$v=19$m=65536,t=3,p=4$TRlPvUnFp9vKIOd7csB64Q$UFxtYl70a5DrUNWOUuqZyM1OLdmIQXR4EUdIOmQmUmo',
       (CASE WHEN i <= 5 THEN 'ADMIN'
             WHEN i % 20 = 0 THEN 'SOC_LEAD'
             WHEN i % 97 = 0 THEN 'READ_ONLY'
             ELSE 'ANALYST' END)::"Role",
       'ACTIVE'::"UserStatus",
       false, 'LOCAL'::"IdentityProvider", now(), now()
FROM generate_series(1, 800) AS i;

\set ON_ERROR_STOP on
\timing on

CREATE TEMP TABLE u AS
SELECT row_number() OVER (ORDER BY username) AS n, id FROM "user";

INSERT INTO "case" (id, title, description, status, severity, tlp, pap,
                    "reporterId", "assigneeId", "sourceSystem",
                    "occurredAt", "createdAt", "updatedAt", tags, "slaBreached")
SELECT gen_random_uuid(),
       'Suspicious activity on host ' || i,
       'Generated for load testing.',
       (ARRAY['NEW','IN_PROGRESS','PENDING','RESOLVED','CLOSED'])[1 + (i % 5)]::"CaseStatus",
       (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])[1 + (i % 4)]::"Severity",
       'AMBER'::"Tlp", 'AMBER'::"Tlp",
       r.id,
       CASE WHEN i % 4 = 0 THEN NULL ELSE a.id END,
       'manual',
       now() - ((i % 1095) * interval '1 day'),
       now() - ((i % 1095) * interval '1 day'),
       now(),
       CASE (i % 4)
         WHEN 0 THEN ARRAY['phishing']
         WHEN 1 THEN ARRAY['malware']
         WHEN 2 THEN ARRAY['brute-force']
         ELSE ARRAY['data-leak']
       END,
       (i % 11 = 0)
FROM generate_series(1, 100000) AS i
JOIN u r ON r.n = 1 + (i % 800)
JOIN u a ON a.n = 1 + ((i * 7) % 800);

INSERT INTO observable (id, type, value, "normalizedValue", "firstSeenAt", "lastSeenAt",
                        "sightingCount", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
       (ARRAY['IP','DOMAIN','URL','HASH_SHA256','EMAIL'])[1 + (i % 5)]::"ObservableType",
       v.val, v.val,
       now() - ((i % 1095) * interval '1 day'), now(), 0, now(), now()
FROM generate_series(1, 2000000) AS i,
LATERAL (SELECT CASE (i % 5)
  WHEN 0 THEN '10.' || ((i/65536) % 256) || '.' || ((i/256) % 256) || '.' || (i % 256) || '.' || i
  WHEN 1 THEN 'host' || i || '.example.test'
  WHEN 2 THEN 'https://example.test/p/' || i
  WHEN 3 THEN md5(i::text) || md5((i+1)::text)
  ELSE 'user' || i || '@example.test' END AS val) v;
\set ON_ERROR_STOP on
\timing on

CREATE TEMP TABLE cn AS
SELECT id, "reporterId", row_number() OVER (ORDER BY number) AS n FROM "case";
CREATE INDEX ON cn (n);

CREATE TEMP TABLE onum AS
SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS n FROM observable;
CREATE INDEX ON onum (n);

-- 20 indicators per case. Eighteen are the case's own; the last two come from a
-- deliberately small shared pool, because a correlation engine with nothing in
-- common to find is not being tested at all.
INSERT INTO case_observable (id, "caseId", "observableId", "isIoc", tlp, "addedById", "addedAt")
SELECT gen_random_uuid(), c.id, o.id, (j % 3 = 0), 'AMBER'::"Tlp", c."reporterId", now()
FROM cn c
CROSS JOIN generate_series(1, 20) AS j
JOIN onum o ON o.n = CASE
  WHEN j <= 18 THEN ((c.n - 1) * 18 + j)
  ELSE 1800000 + 1 + ((c.n * j) % 20000)
END
ON CONFLICT DO NOTHING;

-- The IOC screens sort by how often an indicator has been seen.
UPDATE observable o
   SET "sightingCount" = s.c
  FROM (SELECT "observableId", count(*) AS c FROM case_observable GROUP BY 1) s
 WHERE s."observableId" = o.id;

ANALYZE;

-- Indicator search is `LIKE '%term%'`, which no btree can serve. Without this
-- every search is a parallel sequential scan of two million rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS observable_normalizedvalue_trgm
  ON observable USING gin ("normalizedValue" gin_trgm_ops);
ANALYZE;
