import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { SettingsService } from '../settings/settings.service';
import { ScimService } from './scim.service';
import { ScimException } from './scim.types';

const ID = '6f0c2a4e-3b1d-4c5e-9a7f-1e2d3c4b5a69';
const actor = { keyId: 'key-1', keyName: 'Entra', ip: '203.0.113.7', userAgent: 'vitest' };

function harness(overrides: Record<string, unknown> = {}) {
  const user = {
    id: ID,
    username: 'analyst',
    email: 'analyst@corp.example',
    fullName: 'An Analyst',
    role: 'ANALYST',
    status: 'ACTIVE',
    identityProvider: 'OIDC',
    isRecoveryAccount: false,
    disabledByDirectory: false,
    scimExternalId: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 1),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...user, ...data })),
    },
    refreshToken: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const settings = {
    getIdentityDomainPolicy: vi.fn(async () => ({ domains: [], locked: false })),
  };
  const service = new ScimService(
    prisma as unknown as PrismaService,
    { record: vi.fn(async () => undefined) } as unknown as AuditService,
    settings as unknown as SettingsService,
  );
  return { service, prisma };
}

const activate = { Operations: [{ op: 'replace', path: 'active', value: true }] };
const deactivate = { Operations: [{ op: 'replace', path: 'active', value: false }] };
const moveAddress = {
  Operations: [{ op: 'replace', path: 'userName', value: 'someone.else@corp.example' }],
};

describe('ScimService safety rails', () => {
  it('does not re-enable an account an administrator disabled', async () => {
    const { service, prisma } = harness({ status: 'DISABLED', disabledByDirectory: false });

    await expect(service.patch(ID, activate, actor, '')).rejects.toBeInstanceOf(ScimException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('re-enables an account the directory itself disabled', async () => {
    const { service, prisma } = harness({ status: 'DISABLED', disabledByDirectory: true });

    await service.patch(ID, activate, actor, '');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', disabledByDirectory: false }),
      }),
    );
  });

  it('records that the directory did the disabling', async () => {
    const { service, prisma } = harness();

    await service.patch(ID, deactivate, actor, '');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DISABLED', disabledByDirectory: true }),
      }),
    );
  });

  it('leaves an administrator-disabled account theirs when the directory disables it too', async () => {
    const { service, prisma } = harness({ status: 'DISABLED', disabledByDirectory: false });

    await service.patch(ID, deactivate, actor, '');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ disabledByDirectory: false }) }),
    );
  });

  it('refuses to move the address of a local account', async () => {
    const { service, prisma } = harness({ identityProvider: 'LOCAL' });

    await expect(service.patch(ID, moveAddress, actor, '')).rejects.toBeInstanceOf(ScimException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('moves the address of an account the directory owns', async () => {
    const { service, prisma } = harness();

    await service.patch(ID, moveAddress, actor, '');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'someone.else@corp.example' }),
      }),
    );
  });

  it('does not show the break-glass account', async () => {
    const { service } = harness({ isRecoveryAccount: true });

    await expect(service.get(ID, '')).rejects.toMatchObject({ status: 404 });
    await expect(service.patch(ID, moveAddress, actor, '')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 rather than a database error for an id that is not a UUID', async () => {
    const { service, prisma } = harness();

    await expect(service.get('not-a-uuid', '')).rejects.toMatchObject({ status: 404 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
