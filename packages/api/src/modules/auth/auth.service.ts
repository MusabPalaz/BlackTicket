import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { AuditAction, mayUseLocalPassword, type Role } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PasswordService } from '../../common/security/password.service';
import { AuditService } from '../audit/audit.service';
import { UsersService, type PublicUser } from '../users/users.service';
import { TokenService, type TokenPair } from './token.service';
import { TotpService } from './totp.service';
import type { AppEnv } from '../../common/config/env.config';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult extends TokenPair {
  user: PublicUser;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * Verified against when the username does not exist, so a wrong username and
   * a wrong password cost the same amount of time and cannot be told apart.
   */
  private decoyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.decoyHash = await this.passwords.hash(randomBytes(32).toString('hex'));
  }

  async login(
    username: string,
    password: string,
    totpCode: string | undefined,
    context: RequestContext,
  ): Promise<LoginResult> {
    const user = await this.users.findByUsername(username);

    if (!user) {
      await this.passwords.verify(this.decoyHash, password);
      await this.audit.record({
        action: AuditAction.LOGIN_FAILURE,
        entityType: 'User',
        actorIp: context.ip,
        actorUserAgent: context.userAgent,
        metadata: { username, reason: 'UNKNOWN_USER' },
      });
      throw new UnauthorizedException('Invalid username or password');
    }

    const passwordOk = await this.passwords.verifyLocal(user.passwordHash, password);

    if (!passwordOk) {
      await this.registerFailedAttempt(user, context);
      throw new UnauthorizedException('Invalid username or password');
    }

    /*
     * Checked after the password, not before: refusing an SSO-only account up
     * front would answer "does this username exist?" for anyone who asked. By
     * here the caller already knew the password, so the redirect tells them
     * nothing they did not have.
     */
    const authPolicy = await this.settings.getAuthPolicy();
    if (!mayUseLocalPassword(authPolicy, user)) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILURE,
        entityType: 'User',
        entityId: user.id,
        actorId: user.id,
        actorIp: context.ip,
        actorUserAgent: context.userAgent,
        metadata: { username, reason: 'SSO_REQUIRED' },
      });
      throw new UnauthorizedException({
        message: 'Sign in with your organisation account.',
        code: 'SSO_REQUIRED',
      });
    }

    // Password is correct from here on, so specific messages no longer leak
    // anything an attacker does not already know.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(
        `Account is locked until ${user.lockedUntil.toISOString()} after repeated failed sign-ins.`,
      );
    }

    if (user.status === 'DISABLED') {
      throw new ForbiddenException('Account is disabled. Contact an administrator.');
    }

    if (user.totpEnabled) {
      if (!totpCode) {
        throw new UnauthorizedException({
          message: 'Two-factor code required',
          code: 'TOTP_REQUIRED',
        });
      }
      const accepted = await this.verifySecondFactor(user, totpCode);
      if (!accepted) {
        await this.registerFailedAttempt(user, context, 'BAD_TOTP');
        throw new UnauthorizedException({
          message: 'Invalid two-factor code',
          code: 'TOTP_INVALID',
        });
      }
    }

    const refreshed = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        status: user.status === 'PENDING_ACTIVATION' || user.status === 'LOCKED' ? 'ACTIVE' : user.status,
        lastLoginAt: new Date(),
        lastLoginIp: context.ip,
      },
    });

    const pair = await this.tokens.issuePair(
      {
        id: refreshed.id,
        username: refreshed.username,
        role: refreshed.role as Role,
        mustChangePassword: refreshed.mustChangePassword,
      },
      { ip: context.ip, userAgent: context.userAgent },
    );

    await this.audit.record({
      action: AuditAction.LOGIN_SUCCESS,
      entityType: 'User',
      entityId: refreshed.id,
      actorId: refreshed.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
      metadata: { totp: refreshed.totpEnabled },
    });

    return { ...pair, user: UsersService.toPublicUser(refreshed) };
  }

  /** Accepts either a live TOTP code or one single-use recovery code. */
  private async verifySecondFactor(user: User, code: string): Promise<boolean> {
    if (user.totpSecret && this.totp.verifyCode(user.totpSecret, code)) {
      return true;
    }

    const index = await this.totp.consumeRecoveryCode(user.totpRecoveryHash, code);
    if (index === -1) return false;

    const remaining = user.totpRecoveryHash.filter((_, position) => position !== index);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpRecoveryHash: remaining },
    });
    return true;
  }

  private async registerFailedAttempt(
    user: User,
    context: RequestContext,
    reason: 'BAD_PASSWORD' | 'BAD_TOTP' = 'BAD_PASSWORD',
  ): Promise<void> {
    const maxAttempts = this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    const lockMinutes = this.config.get('LOGIN_LOCK_MINUTES', { infer: true });
    const attempts = user.failedLoginCount + 1;
    const shouldLock = attempts >= maxAttempts;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + lockMinutes * 60_000) : user.lockedUntil,
        status: shouldLock ? 'LOCKED' : user.status,
      },
    });

    await this.audit.record({
      action: shouldLock ? AuditAction.ACCOUNT_LOCKED : AuditAction.LOGIN_FAILURE,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
      metadata: { reason, attempts, lockedForMinutes: shouldLock ? lockMinutes : undefined },
    });

    if (shouldLock) {
      // A locked account keeps no live sessions.
      await this.tokens.revokeAllForUser(user.id);
    }
  }

  refresh(refreshToken: string, context: RequestContext): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, { ip: context.ip, userAgent: context.userAgent });
  }

  async logout(userId: string, refreshToken: string | undefined, context: RequestContext): Promise<void> {
    if (refreshToken) {
      await this.tokens.revokeByToken(refreshToken);
    }

    await this.audit.record({
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
      actorId: userId,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const user = await this.users.getByIdOrThrow(userId);

    if (!(await this.passwords.verifyLocal(user.passwordHash, currentPassword))) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILURE,
        entityType: 'User',
        entityId: user.id,
        actorId: user.id,
        actorIp: context.ip,
        actorUserAgent: context.userAgent,
        metadata: { reason: 'BAD_CURRENT_PASSWORD_ON_CHANGE' },
      });
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from the current one.');
    }

    const strength = this.passwords.checkStrength(newPassword, {
      username: user.username,
      email: user.email,
      fullName: user.fullName,
    });
    if (!strength.ok) {
      throw new BadRequestException(strength.message);
    }

    if (await this.passwords.isReused(user.id, newPassword)) {
      throw new BadRequestException('This password was used recently. Choose a different one.');
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await this.passwords.rememberPassword(user.id, passwordHash);

    // Changing a password invalidates every other session: if the change was
    // triggered by a suspected compromise, the attacker's session dies with it.
    const revoked = await this.tokens.revokeAllForUser(user.id);

    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
      metadata: { revokedSessions: revoked },
    });
  }

  async startTotpSetup(userId: string): Promise<{ secret: string; uri: string }> {
    const user = await this.users.getByIdOrThrow(userId);
    if (user.totpEnabled) {
      throw new BadRequestException('Two-factor authentication is already enabled.');
    }

    const setup = this.totp.createSetup(user.username);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: setup.encryptedSecret, totpEnabled: false },
    });

    return { secret: setup.secret, uri: setup.uri };
  }

  async enableTotp(userId: string, code: string, context: RequestContext): Promise<{ recoveryCodes: string[] }> {
    const user = await this.users.getByIdOrThrow(userId);
    if (!user.totpSecret) {
      throw new BadRequestException('Start the two-factor setup first.');
    }
    if (!this.totp.verifyCode(user.totpSecret, code)) {
      throw new BadRequestException('That code did not match. Check your authenticator clock.');
    }

    const { codes, hashes } = await this.totp.createRecoveryCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpRecoveryHash: hashes },
    });

    await this.audit.record({
      action: AuditAction.TOTP_ENABLED,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
    });

    return { recoveryCodes: codes };
  }

  async disableTotp(userId: string, password: string, context: RequestContext): Promise<void> {
    const user = await this.users.getByIdOrThrow(userId);

    // Removing a second factor is a downgrade of the account's security, so it
    // is re-authenticated rather than taken on session trust alone.
    if (!(await this.passwords.verifyLocal(user.passwordHash, password))) {
      throw new UnauthorizedException('Password is incorrect');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null, totpRecoveryHash: [] },
    });

    await this.audit.record({
      action: AuditAction.TOTP_DISABLED,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
    });
  }
}
