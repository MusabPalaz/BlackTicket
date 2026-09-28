/**
 * Phase 5.5 end-to-end check: tag catalogue, playbooks and dashboard metrics.
 *
 *   npx tsx scripts/phase55-e2e.ts
 *
 * Deliberately uses the SOC lead and analyst accounts: everything here is
 * reachable without an administrator, so the suite keeps working when the
 * admin account has a second factor enabled.
 */
import { signInAll } from './session';

const API = 'http://localhost:3000/api/v1';

const ACCOUNTS = {
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

  const stamp = String(Date.now()).slice(-8);

  console.log('\nTag catalogue');
  const tags = await get('/tags', 'analyst2');
  const seeded = tags.body.items.filter((tag: { isSuggested: boolean }) => tag.isSuggested);
  check('catalogue is offered to analysts', seeded.length >= 20, `${seeded.length} suggested tag(s)`);
  check(
    'entries carry a description for the dropdown',
    seeded.every((tag: { description: string | null }) => Boolean(tag.description)),
    'each suggestion explains itself',
  );

  const filtered = await get('/tags?q=phish', 'analyst2');
  check('catalogue is searchable', filtered.body.items.some((tag: { name: string }) => tag.name === 'phishing'), 'q=phish');

  console.log('\nPlaybooks by tag');
  const phishingCase = await post(
    '/cases',
    { title: `Playbook phishing ${stamp}`, severity: 'HIGH', tags: ['phishing'] },
    'analyst2',
  );
  const phishingTasks = await get(`/cases/${phishingCase.body.id}/tasks`, 'analyst2');
  const phishingTitles = phishingTasks.body.items.map((task: { title: string }) => task.title);
  check('a new case arrives with its checklist', phishingTitles.length > 0, `${phishingTitles.length} task(s)`);
  check(
    'standard questions are present',
    ['Log Review', 'False Positive', 'Enterprise Search', 'Executive Summary'].every((title) =>
      phishingTitles.includes(title),
    ),
    'Log Review, False Positive, Enterprise Search, Executive Summary',
  );
  check(
    'phishing questions are present',
    ['Block Sender', 'Purge', 'Domain Block', 'Password Reset'].every((title) => phishingTitles.includes(title)),
    'Block Sender, Purge, Domain Block, Password Reset',
  );
  check(
    'endpoint questions are not',
    !phishingTitles.includes('Affected Host') && !phishingTitles.includes('Re-image'),
    'a phishing case is not asked about re-imaging',
  );

  const edrCase = await post(
    '/cases',
    { title: `Playbook EDR ${stamp}`, severity: 'HIGH', tags: ['xdr', 'malware'] },
    'analyst2',
  );
  const edrTasks = await get(`/cases/${edrCase.body.id}/tasks`, 'analyst2');
  const edrTitles = edrTasks.body.items.map((task: { title: string }) => task.title);
  check(
    'an EDR case is asked different questions',
    ['Affected User', 'Affected Host', 'Insider Threat', 'IP Block', 'Disablement', 'Re-image'].every((title) =>
      edrTitles.includes(title),
    ),
    'Affected User/Host, Insider Threat, IP Block, Disablement, Re-image',
  );
  check(
    'containment clean-up is on the list',
    edrTitles.includes('Remove temporary containment measures') &&
      edrTitles.includes('Notify constituents (status update)'),
    'nothing is left contained by accident',
  );

  const withPrompt = edrTasks.body.items.find((task: { title: string }) => task.title === 'Affected Host');
  check('each task carries the question to answer', withPrompt.description.length > 20, `"${withPrompt.description.slice(0, 48)}…"`);
  check('playbook tasks are marked as such', Boolean(withPrompt.templateItemId), 'templateItemId set');

  const untagged = await post('/cases', { title: `Playbook plain ${stamp}`, severity: 'LOW' }, 'analyst2');
  const untaggedTasks = await get(`/cases/${untagged.body.id}/tasks`, 'analyst2');
  check(
    'an untagged case still gets the standard checklist',
    untaggedTasks.body.items.length === 5,
    `${untaggedTasks.body.items.length} task(s), the default playbook only`,
  );

  console.log('\nApplying a playbook after the fact');
  const templates = await get('/task-templates', 'analyst2');
  const edrTemplate = templates.body.items.find((t: { name: string }) => t.name === 'EDR / XDR detection');
  const applied = await post(
    `/cases/${untagged.body.id}/playbooks`,
    { templateIds: [edrTemplate.id] },
    'analyst2',
  );
  check('checklist can be added later', applied.body.applied[0]?.created === 8, `${applied.body.applied[0]?.created} task(s) added`);

  const again = await post(`/cases/${untagged.body.id}/playbooks`, { templateIds: [edrTemplate.id] }, 'analyst2');
  check(
    're-applying does not duplicate',
    again.body.applied.length === 0 && again.body.skipped === 8,
    `${again.body.skipped} already present`,
  );

  console.log('\nPlaybook administration');
  const custom = await post(
    '/admin/task-templates',
    {
      name: `Insider review ${stamp}`,
      description: 'Questions for suspected insider activity',
      matchTags: [`insider-${stamp}`],
      items: [
        { title: 'HR Contact', prompt: 'Has HR been informed, and who is the point of contact?' },
        { title: 'Access Review', prompt: 'What could this account reach, and was any of it touched?' },
      ],
    },
    'lead',
  );
  check('SOC lead can define a playbook', custom.status === 201, custom.body.name);

  const analystTries = await post('/admin/task-templates', { name: 'nope', items: [] }, 'analyst1');
  check('analysts cannot', analystTries.status === 403, analystTries.body.message);

  const customCase = await post(
    '/cases',
    { title: `Insider case ${stamp}`, severity: 'MEDIUM', tags: [`insider-${stamp}`] },
    'analyst2',
  );
  const customTasks = await get(`/cases/${customCase.body.id}/tasks`, 'analyst2');
  const customTitles = customTasks.body.items.map((task: { title: string }) => task.title);
  check(
    'a new tag immediately drives its playbook',
    customTitles.includes('HR Contact') && customTitles.includes('Access Review'),
    'HR Contact, Access Review',
  );

  const registered = await get(`/tags?q=insider-${stamp}`, 'analyst2');
  check(
    'a tag typed by hand joins the catalogue',
    registered.body.items.some((tag: { name: string }) => tag.name === `insider-${stamp}`),
    'so the next analyst can pick it from the list',
  );

  await del(`/admin/task-templates/${custom.body.id}`, 'lead');
  const survivors = await get(`/cases/${customCase.body.id}/tasks`, 'analyst2');
  check(
    'deleting a playbook leaves existing tasks alone',
    survivors.body.items.some((task: { title: string }) => task.title === 'HR Contact'),
    'the work log is the record, not the template',
  );

  console.log('\nDashboard metrics');
  const trend = await get('/metrics/case-trend?days=14', 'viewer');
  check('case trend covers the whole window', trend.body.items.length === 14, `${trend.body.items.length} day buckets`);
  check(
    'days with no activity are present as zeros',
    trend.body.items.every((day: { date: string; opened: number }) => typeof day.opened === 'number'),
    'no gaps for the chart to guess at',
  );

  const severity = await get('/metrics/open-by-severity', 'viewer');
  check('severity breakdown lists every level', severity.body.items.length === 4, 'LOW to CRITICAL');

  const sla = await get('/metrics/sla?days=30', 'lead');
  check('SLA compliance computed', typeof sla.body.closed === 'number', `${sla.body.compliance ?? '—'}% of ${sla.body.closed} closed`);

  const workload = await get('/metrics/workload', 'lead');
  check('workload names people, not ids', workload.body.items.every((row: { name: string }) => !/^[0-9a-f-]{36}$/.test(row.name)), workload.body.items.map((r: { name: string }) => r.name).slice(0, 3).join(', '));

  const observables = await get('/metrics/top-observables?limit=5', 'analyst1');
  check('recurring indicators available', Array.isArray(observables.body.items), `${observables.body.items.length} indicator(s) seen more than once`);

  const clamped = await get('/metrics/case-trend?days=9999', 'viewer');
  check('a silly window is clamped, not obeyed', clamped.body.items.length <= 365, `${clamped.body.items.length} buckets`);

  console.log('\nDashboard layout');
  const layout = { dashboard: { widgets: [{ id: 'sla', width: 'half' }, { id: 'due-soon', width: 'full' }] } };
  const saved = await request('PUT', '/me/preferences', { preferences: layout }, 'analyst1');
  check('layout saved on the account', saved.status === 200, '2 widget(s)');

  const reloaded = await get('/me/preferences', 'analyst1');
  check(
    'layout comes back on the next sign-in',
    reloaded.body.preferences.dashboard.widgets.length === 2,
    'follows the analyst between machines',
  );

  const others = await get('/me/preferences', 'analyst2');
  check(
    'one analyst cannot see another layout',
    JSON.stringify(others.body.preferences) !== JSON.stringify(layout),
    'preferences are per account',
  );

  const oversized = await request(
    'PUT',
    '/me/preferences',
    { preferences: { junk: 'x'.repeat(40_000) } },
    'analyst1',
  );
  check('the column cannot be used as free storage', Boolean(oversized.body.error), oversized.body.error ?? 'accepted');

  // Leave the account as we found it.
  await request('PUT', '/me/preferences', { preferences: {} }, 'analyst1');

  console.log('\nDrill-down filters');
  const today = new Date().toISOString().slice(0, 10);
  const openedToday = await get(
    `/cases?dateField=createdAt&from=${today}T00:00:00.000Z&to=${today}T23:59:59.999Z`,
    'lead',
  );
  check(
    'a day on the trend chart resolves to cases opened that day',
    openedToday.body.items.every((row: { createdAt: string }) => row.createdAt.slice(0, 10) === today),
    `${openedToday.body.total} case(s) opened today`,
  );

  const breached = await get('/cases?breached=true', 'lead');
  check(
    'the SLA widget resolves to breached cases only',
    breached.body.items.every((row: { slaBreached: boolean }) => row.slaBreached),
    `${breached.body.total} breached`,
  );

  const unassigned = await get('/cases?status=NEW,IN_PROGRESS,PENDING&unassigned=true', 'lead');
  check(
    'the workload chart resolves unassigned work',
    unassigned.body.items.every((row: { assignee: unknown }) => row.assignee === null),
    `${unassigned.body.total} unassigned`,
  );

  const byTechnique = await get('/cases?mitre=T1566.002', 'lead');
  check(
    'an ATT&CK technique resolves to the cases tagged with it',
    byTechnique.body.items.every((row: { mitre: { id: string }[] }) =>
      row.mitre.some((technique) => technique.id === 'T1566.002'),
    ),
    `${byTechnique.body.total} case(s) tagged T1566.002`,
  );

  const byTag = await get('/cases?tag=phishing', 'lead');
  check(
    'a tag from the chart resolves to that tag, not a text search',
    byTag.body.items.every((row: { tags: string[] }) => row.tags.includes('phishing')),
    `${byTag.body.total} case(s) tagged phishing`,
  );


  console.log('\nTag-driven case editing');
  const retagged = await patch(`/cases/${phishingCase.body.id}`, { tags: ['phishing', `custom-${stamp}`] }, 'analyst2');
  check('tags are normalised on update too', retagged.body.tags.includes(`custom-${stamp}`), retagged.body.tags.join(', '));

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
