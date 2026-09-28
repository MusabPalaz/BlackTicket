/**
 * Phase 3 end-to-end check: observables and the correlation engine.
 *
 *   npx tsx scripts/phase3-e2e.ts
 *
 * Creates two fresh cases, feeds them indicators the way an analyst would
 * (defanged, mixed spelling, pasted in bulk) and asserts that the engine links
 * exactly what it should — and stays quiet where it should.
 */
import { signInAll, adminAccount } from './session';

const API = 'http://localhost:3000/api/v1';

const ACCOUNTS = {
  admin: adminAccount(),
  lead: ['soclead1', 'quartz-harbor-lantern-72'],
  analyst1: ['analyst1', 'meadow-copper-signal-31'],
  analyst2: ['analyst2', 'gravel-ribbon-tundra-59'],
  viewer: ['viewer1', 'cinder-plateau-mango-25'],
} as const;

type Who = keyof typeof ACCOUNTS;
const tokens = new Map<Who, string>();

async function request(method: string, path: string, body?: unknown, who?: Who) {
  const response = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(who ? { Authorization: `Bearer ${tokens.get(who)}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const get = (p: string, who: Who) => request('GET', p, undefined, who);
const post = (p: string, b: unknown, who: Who) => request('POST', p, b, who);
const patch = (p: string, b: unknown, who: Who) => request('PATCH', p, b, who);
const del = (p: string, who: Who) => request('DELETE', p, undefined, who);

let failures = 0;
function check(label: string, condition: boolean, detail: string) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
  if (!condition) failures += 1;
}

async function main() {
  for (const [who, token] of await signInAll(ACCOUNTS)) {
    tokens.set(who as Who, token);
  }

  const stamp = Date.now();

  /*
   * Indicators are made unique per run. Correlation counts are global by
   * design, so reusing a fixed IP would make the second run of this script
   * fail against data the first run left behind — the test has to be
   * repeatable to be worth anything.
   */
  const sharedIp = `203.0.113.${(stamp % 200) + 20}`;
  const sharedIpDefanged = sharedIp.replace(/\.(\d+)$/, '[.]$1');
  const evilDomain = `evil-${stamp}.example`;
  // A per-run hash, so a previous run's case cannot correlate into this one.
  const sharedHash = stamp.toString(16).padStart(64, 'a');
  const first = await post(
    '/cases',
    { title: `Phishing wave A ${stamp}`, severity: 'HIGH' },
    'analyst2',
  );
  const second = await post(
    '/cases',
    { title: `Suspicious login B ${stamp}`, severity: 'MEDIUM' },
    'analyst1',
  );
  const caseA = first.body.id as string;
  const caseB = second.body.id as string;

  console.log('\nNormalisation on the way in');
  const added = await post(
    `/cases/${caseA}/observables`,
    {
      items: [
        { type: 'IP', value: sharedIpDefanged, isIoc: true },
        { type: 'DOMAIN', value: `${evilDomain.toUpperCase()}.`, isIoc: true },
        { type: 'URL', value: `hxxps://login.${evilDomain.replace('.', '[.]')}:443/sso#top` },
        { type: 'HASH_SHA256', value: sharedHash.toUpperCase() },
        { type: 'IP', value: '10.10.5.7' },
        { type: 'IP', value: 'not-an-ip' },
        // A SHA-256 filed as MD5: rejected rather than stored under the wrong type.
        { type: 'HASH_MD5', value: sharedHash },
      ],
    },
    'analyst2',
  );
  const normalizedValues = added.body.added.map(
    (entry: { observable: { normalized: string } }) => entry.observable.normalized,
  );
  check(
    'defanged IP normalised',
    normalizedValues.includes(sharedIp),
    `${sharedIpDefanged} -> ${sharedIp}`,
  );
  check(
    'domain lower-cased, trailing dot dropped',
    normalizedValues.includes(evilDomain),
    `${evilDomain.toUpperCase()}. -> ${evilDomain}`,
  );
  check(
    'URL refanged, default port and fragment dropped',
    normalizedValues.includes(`https://login.${evilDomain}/sso`),
    `hxxps://...:443/sso#top -> https://login.${evilDomain}/sso`,
  );
  check('hash lower-cased', normalizedValues.includes(sharedHash), 'uppercase -> lowercase');
  check(
    'invalid value rejected with a reason',
    added.body.rejected.length === 2,
    JSON.stringify(added.body.rejected.map((r: { reason: string }) => r.reason)),
  );
  check(
    'nothing correlated yet',
    added.body.correlations.length === 0,
    'first case holding these indicators',
  );

  console.log('\nDuplicates within one case');
  const again = await post(
    `/cases/${caseA}/observables`,
    { items: [{ type: 'IP', value: sharedIp }] },
    'analyst2',
  );
  check(
    'same indicator, different spelling, no duplicate row',
    again.body.duplicates.length === 1,
    JSON.stringify(again.body.duplicates),
  );

  console.log('\nCorrelation');
  const onB = await post(
    `/cases/${caseB}/observables`,
    {
      items: [
        // Same host as case A, written plainly rather than defanged.
        { type: 'IP', value: sharedIp, isIoc: true },
        { type: 'IP', value: '10.10.5.7' },
      ],
    },
    'analyst1',
  );
  check(
    'shared indicator links the two cases',
    onB.body.correlations.length === 1,
    JSON.stringify(onB.body.correlations.map((c: { reference: string }) => c.reference)),
  );
  check(
    'whitelisted internal range produces no link',
    !onB.body.correlations.some(
      (c: { observable: { normalized: string } }) => c.observable.normalized === '10.10.5.7',
    ),
    '10.10.5.7 is inside the seeded 10.0.0.0/8 rule',
  );

  const relatedA = await get(`/cases/${caseA}/related`, 'viewer');
  check(
    'related panel shows the other case',
    relatedA.body.items.length === 1,
    `${relatedA.body.items[0]?.case?.reference} via ${relatedA.body.items[0]?.sharedObservables?.[0]?.value}`,
  );
  check(
    'relationship is readable from both sides',
    (await get(`/cases/${caseB}/related`, 'viewer')).body.items.length === 1,
    'symmetric',
  );

  console.log('\nGlobal indicator search');
  const search = await get(`/observables/search?q=${sharedIp}`, 'viewer');
  const hit = search.body.items[0];
  check('search finds the indicator', Boolean(hit), hit?.normalized);
  check(
    'sighting count reflects both cases',
    hit?.sightingCount === 2,
    `sightingCount=${hit?.sightingCount}`,
  );
  check(
    'search accepts defanged input',
    (await get(`/observables/search?q=${encodeURIComponent(sharedIpDefanged)}`, 'viewer')).body
      .items.length === 1,
    'refanged before matching',
  );

  const sightings = await get(`/observables/${hit.id}/sightings`, 'viewer');
  check(
    'sightings list every case',
    sightings.body.items.length === 2,
    sightings.body.items.map((s: { reference: string }) => s.reference).join(', '),
  );

  console.log('\nIOC flag and manual links');
  const caseObservableId = added.body.added.find(
    (e: { observable: { normalized: string } }) => e.observable.normalized === evilDomain,
  ).id;
  const flagged = await patch(
    `/case-observables/${caseObservableId}`,
    { isIoc: false, tlp: 'RED' },
    'analyst2',
  );
  check(
    'IOC flag and TLP editable',
    flagged.body.isIoc === false && flagged.body.tlp === 'RED',
    'isIoc=false tlp=RED',
  );

  const manual = await post(
    `/cases/${caseA}/links`,
    { targetCaseId: caseB, reason: 'Same actor infrastructure' },
    'analyst2',
  );
  check('manual link created', manual.status === 201, manual.body.reason);
  const duplicateManual = await post(
    `/cases/${caseA}/links`,
    { targetCaseId: caseB, reason: 'again' },
    'analyst2',
  );
  check(
    'duplicate manual link refused',
    duplicateManual.status === 400,
    duplicateManual.body.message,
  );
  const selfLink = await post(
    `/cases/${caseA}/links`,
    { targetCaseId: caseA, reason: 'Linking a case to itself' },
    'analyst2',
  );
  check(
    'self-link refused',
    selfLink.status === 400 && String(selfLink.body.message).includes('itself'),
    selfLink.body.message,
  );

  console.log('\nPermissions');
  const viewerAdds = await post(
    `/cases/${caseA}/observables`,
    { items: [{ type: 'IP', value: '9.9.9.9' }] },
    'viewer',
  );
  check('read-only cannot attach observables', viewerAdds.status === 403, viewerAdds.body.message);
  const viewerWhitelist = await get('/admin/whitelist', 'analyst1');
  check(
    'analyst cannot read the whitelist',
    viewerWhitelist.status === 403,
    viewerWhitelist.body.message,
  );

  console.log('\nWhitelist administration');
  const badCidr = await post(
    '/admin/whitelist',
    { type: 'IP', pattern: '10.0.0.0/33', isCidr: true },
    'admin',
  );
  check('invalid CIDR refused', badCidr.status === 400, badCidr.body.message);
  const wildcard = await post(
    '/admin/whitelist',
    { type: 'DOMAIN', pattern: '*.microsoft.com', reason: 'high-noise vendor' },
    'lead',
  );
  check('SOC lead can add a wildcard domain rule', wildcard.status === 201, wildcard.body.pattern);

  const thirdCase = await post(
    '/cases',
    { title: `Vendor noise ${stamp}`, severity: 'LOW' },
    'analyst2',
  );
  await post(
    `/cases/${thirdCase.body.id}/observables`,
    { items: [{ type: 'DOMAIN', value: `login-${stamp}.microsoft.com` }] },
    'analyst2',
  );
  const fourthCase = await post(
    '/cases',
    { title: `Vendor noise 2 ${stamp}`, severity: 'LOW' },
    'analyst2',
  );
  const noiseAdd = await post(
    `/cases/${fourthCase.body.id}/observables`,
    { items: [{ type: 'DOMAIN', value: `login-${stamp}.microsoft.com` }] },
    'analyst2',
  );
  check(
    'whitelisted domain does not correlate',
    noiseAdd.body.correlations.length === 0,
    'no link between the two vendor cases',
  );

  await del(`/admin/whitelist/${wildcard.body.id}`, 'admin');

  console.log('\nRemoving an observable withdraws its link');
  const bObservables = await get(`/cases/${caseB}/observables`, 'analyst1');
  const sharedOnB = bObservables.body.items.find(
    (e: { observable: { normalized: string } }) => e.observable.normalized === sharedIp,
  );
  await del(`/case-observables/${sharedOnB.id}`, 'analyst1');
  const afterRemoval = await get(`/cases/${caseA}/related`, 'viewer');
  const automaticLeft = afterRemoval.body.items.flatMap(
    (i: { sharedObservables: unknown[] }) => i.sharedObservables,
  );
  check(
    'automatic link disappears with the indicator',
    automaticLeft.length === 0,
    'only the manual link remains',
  );
  check(
    'manual link survives',
    afterRemoval.body.items.length === 1,
    `${afterRemoval.body.items[0]?.manualReasons?.[0]?.reason}`,
  );

  const searchAfter = await get(`/observables/search?q=${sharedIp}`, 'viewer');
  check(
    'sighting count decremented',
    searchAfter.body.items[0]?.sightingCount === 1,
    `sightingCount=${searchAfter.body.items[0]?.sightingCount}`,
  );

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
