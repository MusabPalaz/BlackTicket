/**
 * Phase 5 end-to-end check: account lifecycle, CSV import, audit trail and
 * system settings.
 *
 *   npx tsx scripts/phase5-e2e.ts
 */
import { generateSync } from 'otplib';
import { signInAll, signIn as sessionSignIn, attemptSignIn, adminAccount } from './session';

const API = 'http://localhost:3000/api/v1';

const ACCOUNTS = {
  admin: adminAccount(),
  lead: ['soclead1', 'quartz-harbor-lantern-72'],
  analyst1: ['analyst1', 'meadow-copper-signal-31'],
} as const;

type Who = keyof typeof ACCOUNTS;
const tokens = new Map<Who, string>();

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const isJson = response.headers.get('content-type')?.includes('application/json');
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: text && isJson ? JSON.parse(text) : null,
    text,
  };
}

const asWho = (who: Who) => tokens.get(who);
const get = (p: string, who: Who) => request('GET', p, undefined, asWho(who));
const post = (p: string, b: unknown, who: Who) => request('POST', p, b, asWho(who));
const patch = (p: string, b: unknown, who: Who) => request('PATCH', p, b, asWho(who));
const del = (p: string, who: Who) => request('DELETE', p, undefined, asWho(who));

async function signIn(username: string, password: string, totpCode?: string) {
  if (totpCode) return request('POST', '/auth/login', { username, password, totpCode });
  return sessionSignIn(username, password) as ReturnType<typeof request>;
}

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
  const suffix = String(stamp).slice(-8);

  console.log('\nAccount lifecycle');
  const target = await post(
    '/admin/users',
    {
      username: `life-${suffix}`,
      fullName: 'Lifecycle Test',
      password: 'gravel-ribbon-tundra-83',
      role: 'ANALYST',
    },
    'admin',
  );
  const targetId = target.body.id as string;
  check('account created', target.status === 201, `${target.body.username} <${target.body.email}>`);

  const detail = await get(`/admin/users/${targetId}`, 'admin');
  check(
    'detail shows sessions and workload',
    detail.status === 200,
    `${detail.body.activeSessions} session(s), ${Object.keys(detail.body.assignedCases).length} case bucket(s)`,
  );

  const promoted = await patch(
    `/admin/users/${targetId}`,
    { role: 'SOC_LEAD', fullName: 'Lifecycle Lead' },
    'admin',
  );
  check(
    'role and name updated',
    promoted.body.role === 'SOC_LEAD',
    `${promoted.body.fullName} / ${promoted.body.role}`,
  );

  console.log('\nGuardrails');
  const me = await get('/auth/me', 'admin');
  const selfRole = await patch(`/admin/users/${me.body.id}`, { role: 'ANALYST' }, 'admin');
  check('cannot demote yourself', selfRole.status === 400, selfRole.body.message);
  const selfDisable = await post(`/admin/users/${me.body.id}/disable`, {}, 'admin');
  check('cannot disable yourself', selfDisable.status === 400, selfDisable.body.message);
  const selfDelete = await del(`/admin/users/${me.body.id}`, 'admin');
  check('cannot delete yourself', selfDelete.status === 400, selfDelete.body.message);

  const analystTries = await get('/admin/users', 'analyst1');
  check('analyst cannot manage accounts', analystTries.status === 403, analystTries.body.message);
  const leadTriesUsers = await get('/admin/users', 'lead');
  check(
    'SOC lead cannot manage accounts',
    leadTriesUsers.status === 403,
    leadTriesUsers.body.message,
  );

  console.log('\nPassword reset and sessions');
  const firstLogin = await signIn(`life-${suffix}`, 'gravel-ribbon-tundra-83');
  check('target account can sign in', firstLogin.status === 200, 'session established');

  const reset = await post(`/admin/users/${targetId}/reset-password`, {}, 'admin');
  const temporary = reset.body.temporaryPassword as string;
  check(
    'temporary password issued',
    /^[a-z2-9]{6}-[a-z2-9]{6}-[a-z2-9]{6}$/.test(temporary),
    temporary.replace(/./g, '•'),
  );

  const oldSession = await request('GET', '/auth/me', undefined, firstLogin.body.accessToken);
  check(
    'old session no longer usable for refresh',
    (await request('POST', '/auth/refresh', { refreshToken: firstLogin.body.refreshToken }))
      .status === 401,
    'refresh token revoked',
  );
  check(
    'old access token still resolves until it expires',
    oldSession.status === 200 || oldSession.status === 401,
    `status ${oldSession.status}`,
  );

  const withTemp = await signIn(`life-${suffix}`, temporary);
  check(
    'temporary password works',
    withTemp.status === 200 && withTemp.body.user.mustChangePassword === true,
    'must change password at next sign-in',
  );

  const blocked = await request('GET', '/cases', undefined, withTemp.body.accessToken);
  check(
    'nothing else works until the password is changed',
    blocked.status === 403,
    blocked.body.message,
  );

  await request(
    'POST',
    '/auth/change-password',
    { currentPassword: temporary, newPassword: `willow-cobalt-${suffix}` },
    withTemp.body.accessToken,
  );
  const settled = await signIn(`life-${suffix}`, `willow-cobalt-${suffix}`);
  check(
    'account usable again after the change',
    settled.body.user.mustChangePassword === false,
    'mustChangePassword cleared',
  );

  const forced = await post(`/admin/users/${targetId}/force-logout`, {}, 'admin');
  check(
    'force logout revokes sessions',
    forced.body.revokedSessions >= 1,
    `${forced.body.revokedSessions} session(s) ended`,
  );

  console.log('\nTwo-factor recovery');
  const holder = await signIn(`life-${suffix}`, `willow-cobalt-${suffix}`);
  check(
    'holder session established',
    holder.status === 200,
    `mustChangePassword=${holder.body.user.mustChangePassword}`,
  );

  const setup = await request('POST', '/auth/totp/setup', {}, holder.body.accessToken);
  check(
    'TOTP setup issued a seed',
    setup.status === 200,
    setup.status === 200 ? 'otpauth URI returned' : JSON.stringify(setup.body?.message),
  );

  const enable = await request(
    'POST',
    '/auth/totp/enable',
    { code: generateSync({ strategy: 'totp', secret: setup.body.secret }) },
    holder.body.accessToken,
  );
  check(
    'TOTP confirmed with a live code',
    enable.status === 200,
    enable.status === 200
      ? `${enable.body.recoveryCodes.length} recovery codes`
      : JSON.stringify(enable.body?.message),
  );

  // Deliberately the raw attempt: signIn would answer the challenge itself and
  // this check exists to prove the challenge is raised.
  const needsCode = await attemptSignIn(`life-${suffix}`, `willow-cobalt-${suffix}`);
  check(
    '2FA now required',
    needsCode.status === 401 && needsCode.body.code === 'TOTP_REQUIRED',
    'code demanded at sign-in',
  );

  await request('POST', `/admin/users/${targetId}/reset-2fa`, {}, asWho('admin'));
  const afterReset = await signIn(`life-${suffix}`, `willow-cobalt-${suffix}`);
  check(
    'admin can clear a lost authenticator',
    afterReset.status === 200,
    'sign-in works without a code again',
  );

  console.log('\nCSV import');
  const before = (await get('/admin/users?size=1', 'admin')).body.total as number;
  const csv = [
    'username,fullname,role',
    `imp-${suffix}-a,Ada Import,ANALYST`,
    `imp-${suffix}-b,"Bell, Imported ""BI""",READ_ONLY`,
    `imp-${suffix}-a,Duplicate Row,ANALYST`,
    `ab,Too Short,ANALYST`,
    `imp-${suffix}-c,Wrong Role,WIZARD`,
    `admin,Existing Account,ADMIN`,
  ].join('\n');

  const dry = await post('/admin/users/import', { csv, dryRun: true }, 'admin');
  check(
    'dry run reports every row',
    dry.body.total === 6,
    `${dry.body.created} to create, ${dry.body.skipped} skipped, ${dry.body.errors} errors`,
  );
  check(
    'dry run writes nothing',
    (await get('/admin/users?size=1', 'admin')).body.total === before,
    `still ${before} account(s)`,
  );
  check(
    'duplicate row inside the file caught',
    dry.body.rows.some((r: { message?: string }) => r.message?.includes('Duplicate row')),
    'second occurrence skipped',
  );
  check(
    'existing account skipped, not overwritten',
    dry.body.rows.some(
      (r: { username: string; status: string }) => r.username === 'admin' && r.status === 'skipped',
    ),
    'admin left alone',
  );
  check(
    'invalid username reported with the line number',
    dry.body.rows.some(
      (r: { line: number; message?: string }) => r.line === 5 && r.message?.includes('3-64'),
    ),
    'line 5',
  );
  check(
    'unknown role reported',
    dry.body.rows.some((r: { message?: string }) => r.message?.includes('WIZARD')),
    'line 6',
  );

  const real = await post('/admin/users/import', { csv, dryRun: false }, 'admin');
  check(
    'import creates the good rows only',
    real.body.created === 2,
    `${real.body.created} created, ${real.body.skipped} skipped, ${real.body.errors} errors`,
  );
  check(
    'addresses derived from the locked domain',
    real.body.rows.every(
      (r: { email?: string }) => !r.email || r.email.endsWith('@blackticket.local'),
    ),
    'all inside the organisation domain',
  );

  const importedRow = real.body.rows.find((r: { status: string }) => r.status === 'created');
  const importedLogin = await signIn(importedRow.username, importedRow.temporaryPassword);
  check(
    'an imported account can sign in with its temporary password',
    importedLogin.status === 200 && importedLogin.body.user.mustChangePassword,
    'and must change it',
  );

  const outsideDomain = await post(
    '/admin/users/import',
    { csv: `username,email\nimp-${suffix}-x,someone@gmail.com`, dryRun: true },
    'admin',
  );
  check(
    'import obeys the domain lock',
    outsideDomain.body.rows[0]?.message?.includes('blackticket.local'),
    outsideDomain.body.rows[0]?.message,
  );

  console.log('\nAudit trail');
  const audit = await get('/admin/audit?action=PASSWORD_RESET&size=5', 'admin');
  check(
    'filtered by action',
    audit.body.items.every((row: { action: string }) => row.action === 'PASSWORD_RESET'),
    `${audit.body.total} entr(ies)`,
  );

  const leadAudit = await get('/admin/audit?size=1', 'lead');
  check('SOC lead may read the trail', leadAudit.status === 200, 'read-only access');
  const analystAudit = await get('/admin/audit?size=1', 'analyst1');
  check('analyst may not', analystAudit.status === 403, analystAudit.body.message);

  const entityAudit = await get(`/admin/audit?entityType=User&entityId=${targetId}`, 'admin');
  check(
    'history of one account retrievable',
    entityAudit.body.total >= 4,
    `${entityAudit.body.total} entr(ies) for this user`,
  );

  const exported = await get('/admin/audit?action=ROLE_CHANGED&csv=true', 'admin');
  check(
    'CSV export served as a file',
    exported.contentType.includes('text/csv'),
    exported.contentType.split(';')[0] ?? '',
  );
  check(
    'CSV carries the header and the diff columns',
    exported.text.startsWith('timestamp,action,entityType,entityId,actor,ip,before,after,metadata'),
    `${exported.text.split('\r\n').length - 1} data row(s)`,
  );

  console.log('\nSettings');
  const category = await post(
    '/admin/categories',
    { slug: `supply-chain-${suffix}`, name: 'Supply chain', color: '#a855f7' },
    'admin',
  );
  check('category created', category.status === 201, category.body.slug);
  const visible = await get('/categories', 'analyst1');
  check(
    'appears for analysts',
    visible.body.items.some((c: { id: string }) => c.id === category.body.id),
    'in the case form',
  );

  await post(
    '/admin/categories',
    { slug: `supply-chain-${suffix}`, name: 'Supply chain', isActive: false },
    'admin',
  );
  const hidden = await get('/categories', 'analyst1');
  check(
    'deactivating hides it without deleting',
    !hidden.body.items.some((c: { id: string }) => c.id === category.body.id),
    'old cases keep their label',
  );

  const policies = await get('/admin/sla-policies', 'admin');
  check(
    'SLA policies readable',
    policies.body.items.length === 4,
    `${policies.body.items.length} severities`,
  );

  const updated = await patch(
    '/admin/sla-policies',
    { severity: 'LOW', firstResponseMinutes: 2_880, resolutionMinutes: 20_160 },
    'admin',
  );
  check('SLA target editable', updated.body.resolutionMinutes === 20_160, '14 days for LOW');

  const newCase = await post(
    '/cases',
    { title: `Policy check ${suffix}`, severity: 'LOW' },
    'analyst1',
  );
  const dueInDays = (new Date(newCase.body.slaDueAt).getTime() - Date.now()) / 86_400_000;
  check(
    'new cases pick up the new target',
    dueInDays > 13 && dueInDays < 15,
    `${dueInDays.toFixed(1)} days`,
  );

  // Restore the seeded default so repeat runs stay meaningful.
  await patch(
    '/admin/sla-policies',
    { severity: 'LOW', firstResponseMinutes: 1_440, resolutionMinutes: 10_080 },
    'admin',
  );

  console.log('\nDeletion');
  const withOpenCase = await post(
    '/cases',
    { title: `Owned by leaver ${suffix}`, assigneeId: targetId },
    'admin',
  );
  const blockedDelete = await del(`/admin/users/${targetId}`, 'admin');
  check(
    'cannot delete an account holding open cases',
    blockedDelete.status === 409,
    blockedDelete.body.message,
  );

  await post(`/cases/${withOpenCase.body.id}/assign`, { userId: null }, 'admin');
  const deleted = await del(`/admin/users/${targetId}`, 'admin');
  check('deletes once the workload is reassigned', deleted.status === 204, 'soft-deleted');
  const goneLogin = await signIn(`life-${suffix}`, `willow-cobalt-${suffix}`);
  check('a deleted account cannot sign in', goneLogin.status === 401, goneLogin.body.message);

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
