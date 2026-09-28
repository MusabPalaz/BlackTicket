import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AuditAction, type Role } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AppEnv } from '../../common/config/env.config';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: Role;
  /** Guards use this to force the password rotation flow. */
  mcp: boolean;
  typ: 'access';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Access tokens are short-lived JWTs; refresh tokens are opaque random strings.
 *
 * A refresh token is never stored in readable form — only an HMAC of it, keyed
 * by JWT_REFRESH_SECRET. Read access to the database alone is therefore not
 * enough to mint sessions.
 *
 * Rotation carries a family id. Presenting an already-rotated token means the
 * token leaked and is being replayed, so the whole family is revoked: the
 * attacker and the legitimate user both get logged out, which is the safe
 * outcome.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly audit: AuditService,
  ) {}

  private hashRefreshToken(token: string): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET', { infer: true }))
      .update(token)
      .digest('hex');
  }

  private refreshTtlMs(): number {
    const ttl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 7 * 24 * 60 * 60 * 1000;

    const amount = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    return amount * multiplier;
  }

  signAccessToken(user: {
    id: string;
    username: string;
    role: Role;
    mustChangePassword: boolean;
  }): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      mcp: user.mustChangePassword,
      typ: 'access',
    };
    return this.jwt.sign(payload);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = this.jwt.verify<AccessTokenPayload>(token);
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    return payload;
  }

  async issuePair(
    user: { id: string; username: string; role: Role; mustChangePassword: boolean },
    context: SessionContext,
    familyId: string = randomUUID(),
  ): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        familyId,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    });

    return {
      accessToken: this.signAccessToken(user),
      refreshToken,
      expiresIn: this.accessTtlSeconds(),
    };
  }

  accessTtlSeconds(): number {
    const ttl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const amount = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    return amount * { s: 1, m: 60, h: 3_600, d: 86_400 }[unit];
  }

  /** Rotates a refresh token, detecting replay of an already-used one. */
  async rotate(rawToken: string, context: SessionContext): Promise<TokenPair> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Replay of a rotated token: treat the whole chain as compromised.
      await this.revokeFamily(stored.familyId);
      await this.audit.record({
        action: AuditAction.REFRESH_REUSE_DETECTED,
        entityType: 'RefreshToken',
        entityId: stored.id,
        actorId: stored.userId,
        actorIp: context.ip ?? null,
        actorUserAgent: context.userAgent ?? null,
        metadata: { familyId: stored.familyId },
      });
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; family ${stored.familyId} revoked`,
      );
      throw new UnauthorizedException('Session revoked. Please sign in again.');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (stored.user.status !== 'ACTIVE' || stored.user.deletedAt) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Account is not active');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issuePair(stored.user, context, stored.familyId);
  }

  async revokeByToken(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashRefreshToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
