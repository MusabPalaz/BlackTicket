/**
 * Phase 2 end-to-end check against a running API.
 *
 *   npx tsx scripts/phase2-e2e.ts
 *
 * Exercises the case workflow the way analysts and leads actually hit it,
 * including the paths that must be refused.
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

let failures = 0;
function check(label: string, condition: boolean, detail: string) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
  if (!condition) failures += 1;
}

async function main() {
  for (const [who, token] of await signInAll(ACCOUNTS)) {
    tokens.set(who as Who, token);
  }

  const categories = await get('/categories', 'analyst2');
  const phishing = categories.body.items.find((c: { slug: string }) => c.slug === 'phishing');

  console.log('\nCase creation and permissions');
  const created = await post(
    '/cases',
    {
      title: 'Credential harvesting page hosted on look-alike domain',
      description: 'Reported by a user in finance; page mimics the SSO portal.',
      severity: 'HIGH',
      categoryId: phishing.id,
      tags: ['Phishing', 'credential-theft'],
      mitre: ['T1566.002'],
    },
    'analyst2',
  );
  const caseId = created.body.id as string;
  check(
    'analyst opens a case',
    created.status === 201,
    `${created.body.reference} ${created.body.status}`,
  );
  check(
    'tags are normalised',
    created.body.tags[0] === 'phishing',
    JSON.stringify(created.body.tags),
  );
  check(
    'SLA derived from severity',
    Boolean(created.body.slaDueAt),
    `due ${String(created.body.slaDueAt).slice(0, 16)}`,
  );

  const readOnlyAttempt = await post('/cases', { title: 'nope' }, 'viewer');
  check(
    'read-only cannot open a case',
    readOnlyAttempt.status === 403,
    readOnlyAttempt.body.message,
  );

  const futureCase = await post(
    '/cases',
    { title: 'Time traveller', occurredAt: new Date(Date.now() + 86_400_000).toISOString() },
    'analyst2',
  );
  check(
    'incident time cannot be in the future',
    futureCase.status === 400,
    futureCase.body.message,
  );

  const unknownTechnique = await post(
    '/cases',
    { title: 'Bad technique', mitre: ['T9999'] },
    'analyst2',
  );
  check('unknown MITRE id refused', unknownTechnique.status === 400, unknownTechnique.body.message);

  console.log('\nStatus machine');
  const straightToClosed = await post(`/cases/${caseId}/status`, { status: 'CLOSED' }, 'analyst2');
  check(
    'cannot close through /status',
    straightToClosed.status === 400,
    straightToClosed.body.message,
  );

  const inProgress = await post(`/cases/${caseId}/status`, { status: 'IN_PROGRESS' }, 'analyst2');
  check(
    'NEW to IN_PROGRESS',
    inProgress.status === 200,
    `firstResponseAt ${String(inProgress.body.firstResponseAt).slice(11, 19)}`,
  );

  const backToNew = await post(`/cases/${caseId}/status`, { status: 'NEW' }, 'analyst2');
  check('cannot go back to NEW', backToNew.status === 400, backToNew.body.message);

  console.log('\nOwnership');
  const foreignEdit = await patch(`/cases/${caseId}`, { title: 'hijacked' }, 'analyst1');
  check(
    'analyst cannot edit another analyst case',
    foreignEdit.status === 403,
    foreignEdit.body.message,
  );

  const leadEdit = await patch(`/cases/${caseId}`, { severity: 'CRITICAL' }, 'lead');
  check('SOC lead edits any case', leadEdit.status === 200, `severity ${leadEdit.body.severity}`);
  check(
    'SLA recomputed on severity change',
    leadEdit.body.slaDueAt !== created.body.slaDueAt,
    `due ${String(leadEdit.body.slaDueAt).slice(0, 16)}`,
  );

  const analyst1Id = (await get('/auth/me', 'analyst1')).body.id;
  const analyst2Id = (await get('/auth/me', 'analyst2')).body.id;
  const selfAssign = await post(`/cases/${caseId}/assign`, { userId: analyst1Id }, 'analyst1');
  check(
    'analyst may take a case',
    selfAssign.status === 200,
    `assignee ${selfAssign.body.assignee.username}`,
  );

  const otherAssign = await post(`/cases/${caseId}/assign`, { userId: analyst2Id }, 'analyst1');
  check(
    'analyst cannot hand a case to someone else',
    otherAssign.status === 403,
    otherAssign.body.message,
  );

  const leadAssign = await post(`/cases/${caseId}/assign`, { userId: analyst2Id }, 'lead');
  check(
    'SOC lead can reassign',
    leadAssign.status === 200,
    `assignee ${leadAssign.body.assignee.username}`,
  );

  const viewerId = (await get('/admin/users', 'admin')).body.items.find(
    (u: { username: string }) => u.username === 'viewer1',
  ).id;
  const assignViewer = await post(`/cases/${caseId}/assign`, { userId: viewerId }, 'lead');
  check(
    'read-only account cannot be assigned',
    assignViewer.status === 400,
    assignViewer.body.message,
  );

  console.log('\nTasks and work log');
  const task = await post(
    `/cases/${caseId}/tasks`,
    { title: 'Collect the original message', description: 'Pull the .eml from the mail gateway' },
    'analyst2',
  );
  check('task created', task.status === 201, task.body.title);

  const log = await post(
    `/tasks/${task.body.id}/logs`,
    { body: 'SPF softfail, return-path mismatch, sending IP 185.220.101.4.' },
    'analyst2',
  );
  check('work log appended', log.status === 201, `by ${log.body.author.username}`);

  const done = await patch(`/tasks/${task.body.id}`, { status: 'DONE' }, 'analyst2');
  check(
    'timestamps follow the status',
    Boolean(done.body.startedAt && done.body.completedAt),
    `started ${String(done.body.startedAt).slice(11, 19)} completed ${String(done.body.completedAt).slice(11, 19)}`,
  );

  console.log('\nClosing');
  const shortSummary = await post(
    `/cases/${caseId}/close`,
    { resolution: 'TRUE_POSITIVE', summary: 'done' },
    'analyst2',
  );
  check(
    'closing summary must be substantial',
    shortSummary.status === 400,
    JSON.stringify(shortSummary.body.message),
  );

  const closed = await post(
    `/cases/${caseId}/close`,
    {
      resolution: 'TRUE_POSITIVE',
      summary:
        'Domain blocked at the proxy, three recipients reset, no credential submission observed.',
    },
    'analyst2',
  );
  check(
    'case closed with a resolution',
    closed.status === 200,
    `${closed.body.status} / ${closed.body.resolution}`,
  );
  check(
    'SLA verdict recorded at closing',
    typeof closed.body.slaBreached === 'boolean',
    `breached=${closed.body.slaBreached}`,
  );

  const editClosed = await patch(`/cases/${caseId}`, { title: 'edit after close' }, 'analyst2');
  check('closed case is read-only', editClosed.status === 400, editClosed.body.message);

  const taskOnClosed = await post(`/cases/${caseId}/tasks`, { title: 'sneak in' }, 'analyst2');
  check('no tasks on a closed case', taskOnClosed.status === 400, taskOnClosed.body.message);

  const reopened = await post(`/cases/${caseId}/reopen`, {}, 'lead');
  check(
    'lead reopens',
    reopened.status === 200,
    `${reopened.body.status}, resolution ${reopened.body.resolution}`,
  );

  console.log('\nSearch, timeline and dashboard');
  const search = await get('/cases?q=credential&status=IN_PROGRESS&size=5', 'analyst1');
  check('filtered search finds the case', search.body.total >= 1, `${search.body.total} result(s)`);

  const byNumber = await get(`/cases?q=${created.body.number}`, 'analyst1');
  check(
    'search by case number',
    byNumber.body.items.some((c: { id: string }) => c.id === caseId),
    `${byNumber.body.total} result(s)`,
  );

  const timeline = await get(`/cases/${caseId}/timeline`, 'viewer');
  const kinds = new Set(timeline.body.items.map((e: { kind: string }) => e.kind));
  check(
    'timeline merges audit, tasks and notes',
    kinds.size >= 3,
    `${timeline.body.items.length} events: ${[...kinds].join(', ')}`,
  );

  const summary = await get('/cases/summary', 'lead');
  check(
    'dashboard counters',
    typeof summary.body.open === 'number',
    `open ${summary.body.open}, unassigned ${summary.body.unassigned}, dueSoon ${summary.body.dueSoon}`,
  );

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
