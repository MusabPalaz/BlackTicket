import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import {
  AuthMode,
  DEFAULT_AUTH_POLICY,
  DEFAULT_IDENTITY_DOMAIN_POLICY,
  Role,
  type AuthPolicy,
} from '@black-ticket/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { SettingsService } from '../../settings/settings.service';
import { SsoProvisioningService, type FederatedIdentity } from './sso-provisioning.service';

const ISSUER = 'https://idp.corp.example/realms/soc';
const context = { ip: '203.0.113.7', userAgent: 'vitest' };

const policy: AuthPolicy = {
  ...DEFAULT_AUTH_POLICY,
  mode: AuthMode.SSO,
  roleMap: [{ groupId: 'soc-analysts', groupName: 'SOC analysts', role: Role.ANALYST }],
};

function account(overrides: Partial<User>): User {
  return {
    id: 'user-1',
    username: 'someone',
    email: 'someone@corp.example',
    fullName: 'Some One',
    passwordHash: 'argon2-hash',
    role: Role.ANALYST,
    status: 'ACTIVE',
    mustChangePassword: false,
    totpSecret: null,
    totpEnabled: false,
    totpRecoveryHash: [],
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    lastLoginIp: null,
    createdById: null,
    identityProvider: 'LOCAL',
    externalId: null,
    externalIssuer: null,
    provisionedAt: null,
    scimExternalId: null,
    isRecoveryAccount: false,
    tags: [],
    preferences: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as User;
}

function identity(overrides: Partial<FederatedIdentity>): FederatedIdentity {
  return {
    issuer: ISSUER,
    subject: 'subject-of-the-person-signing-in',
    username: 'mallory',
    email: 'mallory@corp.example',
    emailVerified: true,
    fullName: 'Mallory',
    groups: ['soc-analysts'],
    ...overrides,
  };
}

/** An in-memory user table, enough for the lookups provisioning makes. */
function harness(rows: User[]) {
  const matches = (row: User, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof User] === value);

  const prisma = {
    user: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((row) => matches(row, where)) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        const row = rows.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
      create: vi.fn(async ({ data }: { data: Partial<User> }) =>
        account({ id: 'created', ...data }),
      ),
      count: vi.fn(async () => 1),
    },
  };
  const audit = { record: vi.fn(async () => undefined) };
  const settings = {
    getIdentityDomainPolicy: vi.fn(async () => ({
      ...DEFAULT_IDENTITY_DOMAIN_POLICY,
      domain: 'corp.example',
    })),
  };

  const service = new SsoProvisioningService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    settings as unknown as SettingsService,
  );
  const deniedFor = () =>
    audit.record.mock.calls.map(
      ([entry]) => (entry as { metadata?: { reason?: string } }).metadata?.reason,
    );

  return { service, prisma, deniedFor };
}

describe('federated sign-in: matching an existing account', () => {
  it('never hands out the break-glass account, whatever address the provider sends', async () => {
    const recovery = account({
      id: 'recovery',
      username: 'recovery',
      email: 'recovery@corp.example',
      role: Role.ADMIN,
      isRecoveryAccount: true,
    });
    const { service, prisma, deniedFor } = harness([recovery]);

    await expect(
      service.resolve(identity({ email: 'recovery@corp.example' }), policy, context),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(deniedFor()).toContain('RECOVERY_ACCOUNT');
  });

  it('refuses a break-glass account that was linked before the rule existed', async () => {
    const recovery = account({
      id: 'recovery',
      email: 'recovery@corp.example',
      role: Role.ADMIN,
      isRecoveryAccount: true,
      identityProvider: 'OIDC',
      externalIssuer: ISSUER,
      externalId: 'subject-of-the-person-signing-in',
    });
    const { service, prisma } = harness([recovery]);

    await expect(
      service.resolve(identity({ email: 'recovery@corp.example' }), policy, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not move an account to a second identity at the same provider', async () => {
    const colleague = account({
      email: 'colleague@corp.example',
      identityProvider: 'OIDC',
      externalIssuer: ISSUER,
      externalId: 'subject-of-the-colleague',
    });
    const { service, prisma, deniedFor } = harness([colleague]);

    await expect(
      service.resolve(identity({ email: 'colleague@corp.example' }), policy, context),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(colleague.externalId).toBe('subject-of-the-colleague');
    expect(deniedFor()).toContain('LINKED_TO_OTHER_IDENTITY');
  });

  it('moves the link when the tenant has changed providers', async () => {
    const colleague = account({
      email: 'colleague@corp.example',
      identityProvider: 'OIDC',
      externalIssuer: 'https://old-idp.corp.example',
      externalId: 'subject-at-the-old-provider',
    });
    const { service } = harness([colleague]);

    const user = await service.resolve(
      identity({ email: 'colleague@corp.example' }),
      policy,
      context,
    );

    expect(user.externalIssuer).toBe(ISSUER);
    expect(user.externalId).toBe('subject-of-the-person-signing-in');
  });

  it('refuses to match an address the provider says it has not verified', async () => {
    const colleague = account({ email: 'colleague@corp.example' });
    const { service, prisma, deniedFor } = harness([colleague]);

    await expect(
      service.resolve(
        identity({ email: 'colleague@corp.example', emailVerified: false }),
        policy,
        context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(deniedFor()).toContain('EMAIL_NOT_VERIFIED');
  });

  it.each([
    ['vouches for the address', true],
    ['says nothing about it, as Entra does', null],
  ])('matches the account when the provider %s', async (_label, emailVerified) => {
    const colleague = account({ email: 'colleague@corp.example' });
    const { service } = harness([colleague]);

    const user = await service.resolve(
      identity({ email: 'colleague@corp.example', emailVerified }),
      policy,
      context,
    );

    expect(user.id).toBe(colleague.id);
    expect(user.externalId).toBe('subject-of-the-person-signing-in');
  });

  it('keeps the old address when the provider changes it to an unverified one', async () => {
    const linked = account({
      email: 'mallory@corp.example',
      identityProvider: 'OIDC',
      externalIssuer: ISSUER,
      externalId: 'subject-of-the-person-signing-in',
    });
    const { service } = harness([linked]);

    const user = await service.resolve(
      identity({ email: 'colleague@corp.example', emailVerified: false }),
      policy,
      context,
    );

    expect(user.email).toBe('mallory@corp.example');
  });

  it('still creates an account for someone who has none', async () => {
    const { service, prisma } = harness([]);

    const user = await service.resolve(identity({ emailVerified: null }), policy, context);

    expect(prisma.user.create).toHaveBeenCalledOnce();
    expect(user.email).toBe('mallory@corp.example');
    expect(user.role).toBe(Role.ANALYST);
  });
});
