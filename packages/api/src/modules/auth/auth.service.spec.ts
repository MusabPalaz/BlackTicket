import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTH_POLICY } from '@black-ticket/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PasswordService } from '../../common/security/password.service';
import type { AppEnv } from '../../common/config/env.config';
import type { AuditService } from '../audit/audit.service';
import type { SettingsService } from '../settings/settings.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { TokenService } from './token.service';
import type { TotpService } from './totp.service';

const context = { ip: '203.0.113.7', userAgent: 'vitest' };
const RIGHT = 'harbor-quartz-lantern-97';

function harness(lockedUntil: Date | null) {
  const user = {
    id: 'user-1',
    username: 'analyst',
    email: 'analyst@corp.example',
    fullName: 'An Analyst',
    passwordHash: 'stored-hash',
    role: 'ANALYST',
    status: lockedUntil ? 'LOCKED' : 'ACTIVE',
    mustChangePassword: false,
    totpEnabled: false,
    totpRecoveryHash: [],
    failedLoginCount: 0,
    lockedUntil,
    lastLoginAt: null,
    tags: [],
    isRecoveryAccount: false,
    identityProvider: 'LOCAL',
  };

  const prisma = { user: { update: vi.fn(async ({ data }) => ({ ...user, ...data })) } };
  const users = { findByUsername: vi.fn(async () => user) };
  const passwords = {
    hash: vi.fn(async () => 'decoy-hash'),
    verify: vi.fn(async () => false),
    verifyLocal: vi.fn(async (_hash: string | null, plain: string) => plain === RIGHT),
  };
  const tokens = {
    issuePair: vi.fn(async () => ({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })),
    revokeAllForUser: vi.fn(async () => 0),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const config = {
    get: vi.fn((key: string) => ({ LOGIN_MAX_ATTEMPTS: 5, LOGIN_LOCK_MINUTES: 15 })[key]),
  };
  const settings = { getAuthPolicy: vi.fn(async () => DEFAULT_AUTH_POLICY) };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    passwords as unknown as PasswordService,
    tokens as unknown as TokenService,
    {} as TotpService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<AppEnv, true>,
    settings as unknown as SettingsService,
  );
  return { service, prisma, passwords, tokens, audit };
}

async function failureOf(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return error;
  }
  throw new Error('expected the sign-in to be refused');
}

describe('local sign-in while the account is locked', () => {
  const inFifteenMinutes = () => new Date(Date.now() + 15 * 60_000);
  let locked: ReturnType<typeof harness>;

  beforeEach(async () => {
    locked = harness(inFifteenMinutes());
    await locked.service.onModuleInit();
  });

  it('answers the right password exactly as it answers a wrong one', async () => {
    const right = await failureOf(locked.service.login('analyst', RIGHT, undefined, context));
    const wrong = await failureOf(
      locked.service.login('analyst', 'wrong-guess', undefined, context),
    );

    expect(right).toBeInstanceOf(UnauthorizedException);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect((right as UnauthorizedException).getResponse()).toEqual(
      (wrong as UnauthorizedException).getResponse(),
    );
    expect(locked.tokens.issuePair).not.toHaveBeenCalled();
  });

  it('never checks a guess against the real password', async () => {
    await failureOf(locked.service.login('analyst', RIGHT, undefined, context));

    expect(locked.passwords.verifyLocal).not.toHaveBeenCalled();
    expect(locked.passwords.verify).toHaveBeenCalledWith('decoy-hash', RIGHT);
    expect(locked.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'LOCKED' }) }),
    );
  });

  it('signs in with the right password once the lock has run out', async () => {
    const expired = harness(new Date(Date.now() - 1_000));
    await expired.service.onModuleInit();

    const result = await expired.service.login('analyst', RIGHT, undefined, context);

    expect(result.accessToken).toBe('a');
    expect(expired.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', lockedUntil: null }),
      }),
    );
  });
});
