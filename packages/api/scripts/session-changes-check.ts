/**
 * Checks the changes made in this session, end to end against a running API.
 *
 *   npx tsx scripts/session-changes-check.ts
 *
 * Uses the same seeded SOC lead and analyst accounts as phase55, so it runs
 * without the administrator's second factor.
 */
import { API, signInAll } from './session';

const ACCOUNTS = {
  lead: ['soclead1', 'quartz-harbor-lantern-72'],
  analyst1: ['analyst1', 'meadow-copper-signal-31'],
  analyst2: ['analyst2', 'gravel-ribbon-tundra-59'],
} as const;

type Who = keyof typeof ACCOUNTS;
const tokens = new Map<Who, string>();
let failures = 0;

function check(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)}${detail}`);
}

async function call(method: string, path: string, who: Who, body?: unknown) {
  const response = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.get(who)}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed as never, text };
}

async function main(): Promise<void> {
  for (const [who, token] of await signInAll(ACCOUNTS)) tokens.set(who, token);

  console.log('\nObservables search is paged, not capped at 100');
  const first = await call('GET', '/observables/search?size=5&page=1', 'lead');
  check(first.status === 200, 'search answers', `HTTP ${first.status}`);
  const total: number = first.body?.total ?? -1;
  check(typeof total === 'number' && total >= 0, 'total is reported', `${total} indicator(s)`);
  check(first.body?.items?.length <= 5, 'page size is honoured', `${first.body?.items?.length} row(s)`);
  check(first.body?.pages === Math.max(1, Math.ceil(total / 5)), 'page count matches the total', `${first.body?.pages} page(s)`);

  if (total > 5) {
    const second = await call('GET', '/observables/search?size=5&page=2', 'lead');
    const idsA = (first.body?.items ?? []).map((r: { id: string }) => r.id);
    const idsB = (second.body?.items ?? []).map((r: { id: string }) => r.id);
    check(idsB.length > 0 && idsB.every((id: string) => !idsA.includes(id)), 'page 2 is different rows', `${idsB.length} row(s)`);
  }

  const wide = await call('GET', '/observables/search?size=100&page=1', 'lead');
  check(wide.body?.items?.length === Math.min(100, total), 'nothing is silently dropped', `${wide.body?.items?.length} of ${total}`);
  const tooWide = await call('GET', '/observables/search?size=500', 'lead');
  check(tooWide.status === 400, 'an oversized page is refused, not obeyed', `HTTP ${tooWide.status}`);

  console.log('\nAudit export is complete, not the first 5 000 rows');
  const page = await call('GET', '/admin/audit?size=1', 'lead');
  const auditTotal: number = page.body?.total ?? -1;
  check(page.status === 200, 'audit answers', `${auditTotal} entr(ies)`);
  const csv = await call('GET', '/admin/audit?csv=true', 'lead');
  const lines = csv.text.trim().split(/\r?\n/);
  const dataRows = lines.length - 1;
  check(csv.status === 200, 'csv answers', `${csv.text.length} bytes`);
  check(lines[0]?.startsWith('timestamp,action'), 'header row is present', lines[0]?.slice(0, 40));
  check(dataRows >= auditTotal, 'every row is exported', `${dataRows} row(s) for ${auditTotal} entr(ies)`);
  check(auditTotal <= 5_000 || dataRows > 5_000, 'the old 5 000 ceiling is gone', `${dataRows} row(s)`);

  console.log('\nAssignment rules hold when a case is created, not only when it is moved');
  const me = await call('GET', '/auth/me', 'analyst1');
  const selfId: string = me.body?.id;
  const others = await call('GET', '/users/assignable', 'analyst1');
  const other = (others.body?.items ?? []).find((p: { id: string }) => p.id !== selfId);

  const mine = await call('POST', '/cases', 'analyst1', {
    title: `Session check — self assigned ${Date.now()}`,
    description: 'created by scripts/session-changes-check.ts',
    assigneeId: selfId,
  });
  check(mine.status === 201, 'an analyst may open a case assigned to themselves', `HTTP ${mine.status}`);
  check(mine.body?.assignee?.id === selfId, 'the assignee is recorded', mine.body?.assignee?.fullName ?? '');

  const theirs = await call('POST', '/cases', 'analyst1', {
    title: `Session check — should be refused ${Date.now()}`,
    description: 'created by scripts/session-changes-check.ts',
    assigneeId: other?.id,
  });
  check(theirs.status === 403, 'but not one assigned to somebody else', `HTTP ${theirs.status} ${theirs.body?.message ?? ''}`);

  const byLead = await call('POST', '/cases', 'lead', {
    title: `Session check — lead assigns ${Date.now()}`,
    description: 'created by scripts/session-changes-check.ts',
    assigneeId: other?.id,
  });
  check(byLead.status === 201, 'a SOC lead still may assign to anyone', `HTTP ${byLead.status}`);

  console.log('\nAn emptied dashboard is a choice the account keeps');
  await call('PUT', '/me/preferences', 'analyst2', { preferences: { dashboard: { widgets: [] } } });
  const readBack = await call('GET', '/me/preferences', 'analyst2');
  const widgets = readBack.body?.preferences?.dashboard?.widgets;
  check(Array.isArray(widgets) && widgets.length === 0, 'an empty layout survives a round trip', JSON.stringify(widgets));

  await call('PUT', '/me/preferences', 'analyst2', {
    preferences: { dashboard: { widgets: [{ id: 'sla', width: 'half' }] } },
  });
  const restored = await call('GET', '/me/preferences', 'analyst2');
  check(restored.body?.preferences?.dashboard?.widgets?.length === 1, 'and so does a real one', 'sla');

  console.log('\nValidation runs on every controller the autofix had touched');
  for (const [label, path, payload] of [
    ['cases', '/cases', { title: '', unknownField: 1 }],
    ['alerts', '/alerts?status=NOPE', undefined],
    ['observables', '/cases/not-a-uuid/observables', { observables: [] }],
  ] as const) {
    const method = payload === undefined ? 'GET' : 'POST';
    const result = await call(method, path, 'lead', payload);
    check(result.status === 400, `${label} rejects a malformed request`, `HTTP ${result.status}`);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

void main();
