/**
 * Checks the break-glass account protections and bulk deletion.
 *
 *   BT_ADMIN_USER=<admin> BT_ADMIN_PASS=<password> npx tsx scripts/recovery-account-check.ts
 *
 * Creates its own throwaway account, marks it as the recovery account against
 * the database, asserts every screen-reachable way of removing it is refused,
 * then clears the flag and deletes it. Nothing is left behind.
 */
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { API, signIn, adminAccount } from './session';

config({ path: '../../.env' });

let failures = 0;
let token = '';

function check(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}`);
}

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed as never };
}

async function main(): Promise<void> {
  const admin = adminAccount();
  const session = await signIn(...admin);
  if (!session.body?.accessToken) {
    throw new Error(
      `cannot sign in as ${admin[0]}: ${session.body?.message ?? session.status}`,
    );
  }
  token = session.body.accessToken;

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const suffix = Date.now().toString().slice(-8);

  console.log('\nThe recovery account cannot be taken away');
  const created = await call('POST', '/admin/users', {
    username: `rec-${suffix}`,
    fullName: 'Recovery Probe',
    password: 'thicket-lantern-quartz-88',
    role: 'ADMIN',
  });
  check(created.status === 201, 'a throwaway administrator exists', `HTTP ${created.status}`);
  const id: string = created.body?.id;

  await prisma.user.update({ where: { id }, data: { isRecoveryAccount: true } });

  const listed = await call('GET', `/admin/users/${id}`);
  check(
    listed.body?.user?.isRecoveryAccount === true,
    'the flag is visible to the client',
    'so the badge can show',
  );

  const deleted = await call('DELETE', `/admin/users/${id}`);
  check(
    deleted.status === 403,
    'it cannot be deleted',
    `HTTP ${deleted.status} ${deleted.body?.message ?? ''}`,
  );

  const disabled = await call('POST', `/admin/users/${id}/disable`);
  check(
    disabled.status === 403,
    'it cannot be disabled',
    `HTTP ${disabled.status} ${disabled.body?.message ?? ''}`,
  );

  const demoted = await call('PATCH', `/admin/users/${id}`, { role: 'ANALYST' });
  check(
    demoted.status === 403,
    'it cannot be moved off ADMIN',
    `HTTP ${demoted.status} ${demoted.body?.message ?? ''}`,
  );

  const statusOff = await call('PATCH', `/admin/users/${id}`, { status: 'DISABLED' });
  check(
    statusOff.status === 403,
    'nor disabled through the status field',
    `HTTP ${statusOff.status}`,
  );

  const bulkDelete = await call('POST', '/admin/users/bulk', { userIds: [id], action: 'delete' });
  check(
    bulkDelete.body?.changed === 0 && bulkDelete.body?.skipped?.length === 1,
    'a batch refuses it and says why',
    bulkDelete.body?.skipped?.[0]?.reason ?? '',
  );

  const stillThere = await call('GET', `/admin/users/${id}`);
  check(
    stillThere.status === 200 && stillThere.body?.user?.status === 'ACTIVE',
    'it is still standing',
    'ACTIVE',
  );

  console.log('\nOrdinary accounts still delete in a batch');
  const throwaway = await call('POST', '/admin/users', {
    username: `del-${suffix}`,
    fullName: 'Deletable Probe',
    password: 'thicket-lantern-quartz-88',
    role: 'READ_ONLY',
  });
  const spareId: string = throwaway.body?.id;
  const removed = await call('POST', '/admin/users/bulk', { userIds: [spareId], action: 'delete' });
  check(removed.body?.changed === 1, 'a plain account goes', `${removed.body?.changed} removed`);
  const gone = await call('GET', `/admin/users/${spareId}`);
  check(gone.status === 404, 'and is no longer listed', `HTTP ${gone.status}`);

  // Clean up: the flag has to come off before the probe can be removed.
  await prisma.user.update({ where: { id }, data: { isRecoveryAccount: false } });
  const cleanup = await call('DELETE', `/admin/users/${id}`);
  check(
    cleanup.status === 204,
    'the probe is removed once the flag is cleared',
    `HTTP ${cleanup.status}`,
  );

  await prisma.$disconnect();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

void main();
