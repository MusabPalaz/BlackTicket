import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppEnv } from '../../common/config/env.config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuditService } from '../audit/audit.service';
import type { UsersService } from '../users/users.service';
import { TokenService } from './token.service';

const SECRET = 'a-test-secret-that-is-at-least-32-chars';
const context = { ip: '203.0.113.7', userAgent: 'vitest' };
const user = {
  id: 'user-1',
  username: 'analyst',
  role: 'ANALYST' as const,
  mustChangePassword: false,
  status: 'ACTIVE',
  deletedAt: null,
  lockedUntil: null,
};

function harness(options: { claimCount?: number; liveSession?: boolean } = {}) {
  const stored = {
    id: 'rt-1',
    userId: user.id,
    familyId: 'family-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user,
  };
  const tx = {
    refreshToken: {
      updateMany: vi.fn(async () => ({ count: options.claimCount ?? 1 })),
      create: vi.fn(async () => ({})),
    },
  };
  const prisma = {
    refreshToken: {
      findUnique: vi.fn(async () => stored),
      findFirst: vi.fn(async () => (options.liveSession === false ? null : { id: 'rt-2' })),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '15m', issuer: 'black-ticket' },
    verifyOptions: { issuer: 'black-ticket' },
  });
  const config = {
    get: vi.fn(
      (key: string) =>
        ({ JWT_REFRESH_SECRET: `${SECRET}-refresh`, JWT_REFRESH_TTL: '7d', JWT_ACCESS_TTL: '15m' })[
          key
        ],
    ),
  };
  const audit = { record: vi.fn(async () => undefined) };

  const service = new TokenService(
    prisma as unknown as PrismaService,
    jwt,
    config as unknown as ConfigService<AppEnv, true>,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, jwt, audit };
}

describe('TokenService', () => {
  it('ties the access token to the refresh family it was issued with', async () => {
    const { service } = harness();
    const pair = await service.issuePair(user, context, 'family-9');
    expect(service.verifyAccessToken(pair.accessToken).sid).toBe('family-9');
  });

  it('refuses an access token that carries no session id', () => {
    const { service, jwt } = harness();
    const legacy = jwt.sign({ sub: user.id, typ: 'access' });
    expect(() => service.verifyAccessToken(legacy)).toThrow(UnauthorizedException);
  });

  it('rotates within the family in one transaction', async () => {
    const { service, tx, audit } = harness();
    const pair = await service.rotate('raw-token', context);

    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt-1', revokedAt: null } }),
    );
    expect(tx.refreshToken.create).toHaveBeenCalledOnce();
    expect(service.verifyAccessToken(pair.accessToken).sid).toBe('family-1');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats losing the claim to a concurrent request as reuse', async () => {
    const { service, prisma, tx, audit } = harness({ claimCount: 0 });

    await expect(service.rotate('raw-token', context)).rejects.toThrow(UnauthorizedException);
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'family-1', revokedAt: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REFRESH_REUSE_DETECTED' }),
    );
  });
});

describe('JwtAuthGuard', () => {
  function guardFor(liveSession: boolean) {
    const { service } = harness({ liveSession });
    const reflector = { getAllAndOverride: vi.fn(() => false) };
    const users = { findById: vi.fn(async () => user) };
    const guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      service,
      users as unknown as UsersService,
    );
    return { guard, service };
  }

  function contextWith(token: string, request: Record<string, unknown> = {}): ExecutionContext {
    Object.assign(request, { headers: { authorization: `Bearer ${token}` } });
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('lets a token through while its session is live', async () => {
    const { guard, service } = guardFor(true);
    const token = service.signAccessToken(user, 'family-1');
    const request: Record<string, unknown> = {};

    await expect(guard.canActivate(contextWith(token, request))).resolves.toBe(true);
    expect(request.sessionId).toBe('family-1');
  });

  it('refuses a still-valid token once its session has ended', async () => {
    const { guard, service } = guardFor(false);
    const token = service.signAccessToken(user, 'family-1');

    await expect(guard.canActivate(contextWith(token))).rejects.toThrow('Session has ended');
  });
});
