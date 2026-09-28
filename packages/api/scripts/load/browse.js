/**
 * Load profile for the scale in PLAN.md §1.3: 800 registered accounts, 80–105
 * of them working at once.
 *
 * Run against a seeded load-test database, never a working one:
 *
 *   k6 run -e BASE=http://127.0.0.1:3200/api/v1 -e PASS=<password> browse.js
 *
 * Address the target as 127.0.0.1, never as `localhost`. On Windows `localhost`
 * resolves to ::1 first; the API binds IPv4 only, so every new connection waits
 * out a failed IPv6 attempt before falling back. That is ~200 ms of operating
 * system on every connection, and it is easily mistaken for the application
 * being slow — measured here at 204 ms against localhost versus 0.8 ms against
 * 127.0.0.1, for the identical request.
 *
 * The API under test needs its per-IP rate limit raised for the run
 * (RATE_LIMIT_GLOBAL_PER_MIN). All the traffic arrives from one address here,
 * which is an artefact of the harness: in production a hundred analysts are a
 * hundred addresses, each far below the limit. Left at its default the run
 * measures the throttler and nothing else.
 *
 * Two scenarios run together because they stress different things. `browse` is
 * the analyst mix — lists, case detail, indicator lookups — and is where the
 * query plans and indexes are tested. `signin` is deliberately separate and
 * deliberately slow-paced: password verification is Argon2id at 64 MiB, which
 * is expensive *by design*, so hammering it would only prove that a
 * deliberately costly function is costly. What matters is that a Monday-morning
 * arrival rate does not starve everything else.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://127.0.0.1:3200/api/v1';
const PASS = __ENV.PASS;
/** How many accounts the browse scenario borrows sessions from. */
const POOL = Number(__ENV.POOL || 40);
const PEAK = Number(__ENV.PEAK || 100);

const caseList = new Trend('bt_case_list', true);
const caseDetail = new Trend('bt_case_detail', true);
const iocLookup = new Trend('bt_ioc_lookup', true);
const dashboard = new Trend('bt_dashboard', true);
const relatedCases = new Trend('bt_related', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.round(PEAK / 2) },
        { duration: '30s', target: PEAK },
        { duration: '2m', target: PEAK },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    signin: {
      executor: 'constant-arrival-rate',
      exec: 'signin',
      // ~10x a real morning: 800 people arriving over an hour is 0.2/s.
      rate: 2,
      timeUnit: '1s',
      duration: '3m20s',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    // A read that takes longer than this is a screen the analyst waits on.
    // Plain metric name, not a tagged selector: `expected_response` is an HTTP
    // tag and never lands on a custom Trend, so a tagged threshold here matches
    // nothing and passes vacuously at p(95)=0.
    bt_case_list: ['p(95)<800'],
    bt_case_detail: ['p(95)<500'],
    bt_ioc_lookup: ['p(95)<1000'],
    bt_dashboard: ['p(95)<1000'],
    bt_related: ['p(95)<1000'],
    // Argon2id is meant to be slow; the bar is that it stays bounded.
    'http_req_duration{scenario:signin}': ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
  },
};

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` }, tags: { name: 'authed' } };
}

export function setup() {
  if (!PASS) throw new Error('Set -e PASS=<load user password>');

  const tokens = [];
  for (let i = 1; i <= POOL; i += 1) {
    const response = http.post(
      `${BASE}/auth/login`,
      JSON.stringify({ username: `load${i}`, password: PASS }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (response.status === 200) tokens.push(response.json('accessToken'));
  }
  if (tokens.length === 0) throw new Error('No load user could sign in; check PASS and the seed.');

  // Real ids, so case detail is not measured against a cache of one row.
  const listing = http.get(`${BASE}/cases?size=50`, authHeaders(tokens[0]));
  const caseIds = (listing.json('items') || []).map((row) => row.id);

  // Real indicator values, pulled from the API rather than reconstructed from
  // the seed, so the test does not quietly drift from what the data holds.
  const iocs = http.get(`${BASE}/observables/search?q=10.&size=25`, authHeaders(tokens[0]));
  const iocValues = (iocs.json('items') || []).map((row) => row.value).filter(Boolean);

  return { tokens, caseIds, iocValues };
}

/**
 * One analyst's minute, roughly: mostly looking at queues and cases, with the
 * occasional indicator lookup — the query that has to reach across 2M rows.
 */
export function browse(data) {
  const token = data.tokens[(__VU + __ITER) % data.tokens.length];
  const auth = authHeaders(token);
  const caseId = data.caseIds[(__VU * 7 + __ITER) % data.caseIds.length];

  const summary = http.get(`${BASE}/cases/summary`, auth);
  dashboard.add(summary.timings.duration);
  check(summary, { 'summary 200': (r) => r.status === 200 });

  const open = http.get(`${BASE}/cases?status=NEW,IN_PROGRESS&size=25&page=1`, auth);
  caseList.add(open.timings.duration);
  check(open, { 'case list 200': (r) => r.status === 200 });

  const detail = http.get(`${BASE}/cases/${caseId}`, auth);
  caseDetail.add(detail.timings.duration);
  check(detail, { 'case detail 200': (r) => r.status === 200 });

  const related = http.get(`${BASE}/cases/${caseId}/related`, auth);
  relatedCases.add(related.timings.duration);
  check(related, { 'related 200': (r) => r.status === 200 });

  // Only some iterations: an analyst does not search indicators every minute.
  if (__ITER % 3 === 0 && data.iocValues.length > 0) {
    const value = data.iocValues[(__VU + __ITER) % data.iocValues.length];
    const lookup = http.get(
      `${BASE}/observables/search?q=${encodeURIComponent(value)}&size=20`,
      auth,
    );
    iocLookup.add(lookup.timings.duration);
    check(lookup, { 'ioc lookup 200': (r) => r.status === 200 });
  }

  // Think time. Without it this measures how fast a loop can spin, not how the
  // system behaves under people.
  sleep(Math.random() * 3 + 2);
}

/** Arrivals, not a hammer: what a shift change costs the server. */
export function signin() {
  const index = Math.floor(Math.random() * 800) + 1;
  const response = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ username: `load${index}`, password: PASS }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  check(response, { 'login 200': (r) => r.status === 200 });
}
