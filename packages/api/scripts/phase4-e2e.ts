/**
 * Phase 4 end-to-end check: API keys, alert ingest, triage, SLA and notifications.
 *
 *   npx tsx scripts/phase4-e2e.ts
 *
 * Every run uses fresh identifiers so it can be repeated against the same
 * database without tripping over what the previous run left behind.
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

async function request(method: string, path: string, body?: unknown, who?: Who, apiKey?: string) {
  const response = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(who ? { Authorization: `Bearer ${tokens.get(who)}` } : {}),
      ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const get = (p: string, who: Who) => request('GET', p, undefined, who);
const post = (p: string, b: unknown, who: Who) => request('POST', p, b, who);
const del = (p: string, who: Who) => request('DELETE', p, undefined, who);
const ingest = (b: unknown, apiKey?: string) =>
  request('POST', '/ingest/alerts', b, undefined, apiKey);

let failures = 0;
function check(label: string, condition: boolean, detail: string) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
  if (!condition) failures += 1;
}

async function main() {
  for (const [who, token] of await signInAll(ACCOUNTS)) {
    tokens.set(who as Who, token);
  }

  const stamp = Date.now();
  const sharedIp = `198.51.100.${(stamp % 200) + 20}`;

  console.log('\nAPI keys');
  const created = await post('/admin/api-keys', { name: `Wazuh test ${stamp}` }, 'admin');
  const key = created.body.key as string;
  check('key issued with the plaintext returned once', Boolean(key), `${created.body.prefix}…`);

  const listed = await get('/admin/api-keys', 'admin');
  const stored = listed.body.items.find((row: { id: string }) => row.id === created.body.id);
  check(
    'only the prefix is stored readable',
    !JSON.stringify(stored).includes(key.slice(12)),
    `prefix ${stored.prefix}`,
  );

  const analystKeys = await get('/admin/api-keys', 'analyst1');
  check('analyst cannot manage keys', analystKeys.status === 403, analystKeys.body.message);

  console.log('\nIngest authentication');
  check(
    'no key refused',
    (await ingest({ externalId: 'x', source: 'y', title: 'zzz' })).status === 401,
    'X-Api-Key required',
  );
  check(
    'wrong key refused',
    (await ingest({ externalId: 'x', source: 'y', title: 'zzz' }, 'bt_ingest_wrong')).status ===
      401,
    'same message as for an unknown key',
  );

  console.log('\nIngest');
  const alertBody = {
    externalId: `wazuh-${stamp}`,
    source: 'Wazuh',
    title: 'Multiple failed SSH logins from external IP',
    description: '12 failures in 40 seconds against root.',
    severity: 'HIGH',
    category: 'brute-force',
    observables: [
      { type: 'IP', value: sharedIp, isIoc: true },
      { type: 'USERNAME', value: 'root' },
      { type: 'HOSTNAME', value: `srv-app-${stamp}` },
    ],
    mitre: ['T1110.001', 'T9999'],
    raw: { rule: { id: 5710, level: 10 }, agent: { name: 'srv-app-01' } },
  };

  const first = await ingest(alertBody, key);
  check(
    'alert accepted',
    first.status === 200 && first.body.duplicate === false,
    `status ${first.body.status}`,
  );
  check(
    'unknown MITRE id dropped, alert kept',
    first.body.droppedTechniques?.includes('T9999'),
    'T1110.001 kept, T9999 dropped',
  );

  const retry = await ingest(alertBody, key);
  check(
    'retry is idempotent',
    retry.body.duplicate === true && retry.body.id === first.body.id,
    'same alert id returned',
  );

  const invalid = await ingest({ externalId: `bad-${stamp}`, source: 'Wazuh' }, key);
  check(
    'malformed alert rejected',
    invalid.status === 400,
    JSON.stringify(invalid.body.message).slice(0, 60),
  );

  console.log('\nTriage');
  const queue = await get('/alerts?status=NEW&size=5', 'viewer');
  check(
    'read-only can watch the queue',
    queue.status === 200,
    `${queue.body.total} alert(s) waiting`,
  );

  const viewerImport = await post(`/alerts/${first.body.id}/import`, {}, 'viewer');
  check('read-only cannot import', viewerImport.status === 403, viewerImport.body.message);

  const imported = await post(
    `/alerts/${first.body.id}/import`,
    { severity: 'CRITICAL' },
    'analyst2',
  );
  const importedCase = imported.body.case;
  check(
    'alert becomes a case',
    imported.status === 200,
    `${importedCase.reference} ${importedCase.severity}`,
  );
  check(
    'provenance recorded',
    importedCase.sourceSystem === 'Wazuh' && importedCase.sourceRef === alertBody.externalId,
    `${importedCase.sourceSystem}/${importedCase.sourceRef}`,
  );
  check(
    'indicators carried across',
    imported.body.observables.added.length === 3,
    `${imported.body.observables.added.length} observable(s)`,
  );
  check(
    'MITRE tag carried across',
    importedCase.mitre.some((m: { id: string }) => m.id === 'T1110.001'),
    'T1110.001',
  );

  const twice = await post(`/alerts/${first.body.id}/import`, {}, 'analyst2');
  check('an imported alert cannot be imported again', twice.status === 400, twice.body.message);

  console.log('\nMerge and correlation');
  const secondAlert = {
    ...alertBody,
    externalId: `wazuh-${stamp}-b`,
    title: 'Further failed logins from the same address',
    observables: [{ type: 'IP', value: sharedIp, isIoc: true }],
  };
  const second = await ingest(secondAlert, key);
  const merged = await post(
    `/alerts/${second.body.id}/merge`,
    { caseId: importedCase.id },
    'analyst1',
  );
  check('alert merged into the existing case', merged.status === 200, merged.body.case.reference);
  check(
    'no duplicate indicator on merge',
    merged.body.observables.duplicates.length === 1 && merged.body.observables.added.length === 0,
    'the shared IP was already there',
  );

  const thirdAlert = {
    ...alertBody,
    externalId: `wazuh-${stamp}-c`,
    observables: [{ type: 'IP', value: sharedIp }],
  };
  const third = await ingest(thirdAlert, key);
  const separate = await post(`/alerts/${third.body.id}/import`, {}, 'analyst1');
  check(
    'a case opened from a later alert correlates back',
    separate.body.observables.correlations.length === 1,
    `linked to ${separate.body.observables.correlations[0]?.reference}`,
  );

  console.log('\nDismissing');
  const fourth = await ingest({ ...alertBody, externalId: `wazuh-${stamp}-d` }, key);
  const analystIgnore = await post(`/alerts/${fourth.body.id}/ignore`, {}, 'analyst1');
  check(
    'an analyst cannot dismiss an alert',
    analystIgnore.status === 403,
    `status ${analystIgnore.status}`,
  );
  const ignored = await post(
    `/alerts/${fourth.body.id}/ignore`,
    { reason: 'Known scanner' },
    'lead',
  );
  check(
    'a SOC lead dismisses an alert with a reason',
    ignored.body.status === 'IGNORED',
    'reason stored in the audit trail',
  );
  const ignoreImported = await post(`/alerts/${first.body.id}/ignore`, {}, 'lead');
  check(
    'an imported alert cannot be dismissed',
    ignoreImported.status === 400,
    ignoreImported.body.message,
  );

  console.log('\nRestoring');
  const analystRestore = await post(`/alerts/${fourth.body.id}/restore`, {}, 'analyst1');
  check(
    'an analyst cannot restore an alert',
    analystRestore.status === 403,
    `status ${analystRestore.status}`,
  );
  const restored = await post(
    `/alerts/${fourth.body.id}/restore`,
    { reason: 'Scanner was not ours after all' },
    'lead',
  );
  check(
    'a SOC lead puts an ignored alert back in the queue',
    restored.body.status === 'NEW',
    `status ${restored.body.status}`,
  );
  const restoreWaiting = await post(`/alerts/${fourth.body.id}/restore`, {}, 'lead');
  check(
    'only an ignored alert can be restored',
    restoreWaiting.status === 400,
    restoreWaiting.body.message,
  );

  console.log('\nSLA');
  // Backdated so the CRITICAL resolution target (4h) is already blown.
  const overdue = await post(
    '/cases',
    {
      title: `Backdated critical ${stamp}`,
      severity: 'CRITICAL',
      occurredAt: new Date(Date.now() - 8 * 3_600_000).toISOString(),
      assigneeId: (await get('/auth/me', 'analyst2')).body.id,
    },
    'analyst2',
  );
  check(
    'SLA target derived on creation',
    Boolean(overdue.body.slaDueAt),
    `due ${String(overdue.body.slaDueAt).slice(0, 16)}`,
  );
  check('not yet flagged', overdue.body.slaBreached === false, 'the sweep has not run');

  const sweep = await post('/admin/sla/sweep', {}, 'admin');
  check(
    'sweep runs',
    sweep.status === 200,
    `${sweep.body.breached} breached, ${sweep.body.awaitingFirstResponse} awaiting first response`,
  );

  const afterSweep = await get(`/cases/${overdue.body.id}`, 'analyst2');
  check('breach recorded on the case', afterSweep.body.slaBreached === true, 'slaBreached=true');

  const analystSweep = await post('/admin/sla/sweep', {}, 'analyst1');
  check('analysts cannot force a sweep', analystSweep.status === 403, analystSweep.body.message);

  console.log('\nNotifications');
  const notifications = await get('/notifications?unread=true', 'analyst2');
  const breachNotice = notifications.body.items.find(
    (n: { type: string; link: string }) =>
      n.type === 'SLA_BREACH' && n.link === `/cases/${overdue.body.id}`,
  );
  check('assignee notified of the breach', Boolean(breachNotice), breachNotice?.title);

  const before = notifications.body.unread;
  await post('/admin/sla/sweep', {}, 'admin');
  const afterSecondSweep = await get('/notifications?unread=true', 'analyst2');
  check(
    'a second sweep does not repeat the notification',
    afterSecondSweep.body.unread === before,
    `unread stayed at ${before}`,
  );

  await post(`/notifications/${breachNotice.id}/read`, {}, 'analyst2');
  const afterRead = await get('/notifications?unread=true', 'analyst2');
  check(
    'marking read decrements the counter',
    afterRead.body.unread === before - 1,
    `${before} -> ${afterRead.body.unread}`,
  );

  console.log('\nDashboard summary');
  const summary = await get('/alerts/summary', 'lead');
  check(
    'queue and SLA counters exposed',
    typeof summary.body.alerts.NEW === 'number' && typeof summary.body.sla.breached === 'number',
    `NEW=${summary.body.alerts.NEW} IMPORTED=${summary.body.alerts.IMPORTED} breached=${summary.body.sla.breached}`,
  );

  console.log('\nKey revocation');
  const liveKey = await post('/admin/api-keys', { name: `Live key ${stamp}` }, 'admin');
  const deleteLive = await del(`/admin/api-keys/${liveKey.body.id}/permanent`, 'admin');
  check('a key that still works cannot be deleted', deleteLive.status === 409, deleteLive.body.message);
  await del(`/admin/api-keys/${liveKey.body.id}`, 'admin');

  await del(`/admin/api-keys/${created.body.id}`, 'admin');
  const afterRevoke = await ingest({ ...alertBody, externalId: `wazuh-${stamp}-e` }, key);
  check(
    'revoked key stops working immediately',
    afterRevoke.status === 401,
    afterRevoke.body.message,
  );

  console.log('\nKey deletion');
  const beforeDelete = await get('/admin/api-keys', 'admin');
  const doomed = beforeDelete.body.items.find((row: { id: string }) => row.id === created.body.id);
  check(
    'the list reports what a delete would detach',
    typeof doomed.alertCount === 'number',
    `${doomed.alertCount} alert(s)`,
  );

  const purged = await del(`/admin/api-keys/${created.body.id}/permanent`, 'admin');
  check('a revoked key can be deleted for good', purged.status === 204, 'removed from the list');

  const afterDelete = await get('/admin/api-keys', 'admin');
  check(
    'the key no longer accumulates in the list',
    !afterDelete.body.items.some((row: { id: string }) => row.id === created.body.id),
    `${afterDelete.body.items.length} key(s) left`,
  );

  const purgeAgain = await del(`/admin/api-keys/${created.body.id}/permanent`, 'admin');
  check('deleting the same key twice is a 404', purgeAgain.status === 404, purgeAgain.body.message);

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
