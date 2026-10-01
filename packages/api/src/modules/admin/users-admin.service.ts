import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import {
  AuditAction,
  Role,
  buildEmailFromUsername,
  formatDomainList,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
  parseCsv,
  validateEmailAgainstPolicy,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService, type PublicUser } from '../users/users.service';
import { TokenService } from '../auth/token.service';

export interface AdminActor {
  id: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ImportRowResult {
  line: number;
  username: string;
  status: 'created' | 'skipped' | 'error';
  message?: string;
  /** Present only for accounts this run created. */
  temporaryPassword?: string;
  email?: string;
  role?: Role;
}

/**
 * A temporary password is 90 bits of randomness in typeable groups.
 *
 * It has to survive being read down a phone line, and it has to clear the same
 * strength policy every other password does — a random string does both.
 */
function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(18);
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `${chars.slice(0, 6)}-${chars.slice(6, 12)}-${chars.slice(12, 18)}`;
}

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  // ------------------------------------------------------------- guardrails

  /**
   * The system must never end up with no way in.
   *
   * Disabling, demoting or deleting the last active administrator is refused
   * outright — recovering from it would mean editing the database by hand.
   */
  private async assertNotLastAdmin(userId: string, reason: string): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.role !== Role.ADMIN || target.status !== 'ACTIVE') return;

    const otherAdmins = await this.prisma.user.count({
      where: { role: Role.ADMIN, status: 'ACTIVE', deletedAt: null, id: { not: userId } },
    });
    if (otherAdmins === 0) {
      throw new ConflictException(
        `This is the last active administrator; ${reason} would lock everyone out.`,
      );
    }
  }

  private assertNotSelf(actorId: string, targetId: string, action: string): void {
    if (actorId === targetId) {
      throw new BadRequestException(`You cannot ${action} your own account.`);
    }
  }

  /**
   * The break-glass account is the answer to "everything went wrong, how do we
   * get back in". It only works if nothing on any screen can take it away, so
   * the checks are absolute rather than conditional on how many other
   * administrators happen to exist today.
   *
   * Resetting its password and ending its sessions stay allowed: neither
   * removes the way back in, and both are part of using it.
   */
  private async assertNotRecovery(id: string, action: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { isRecoveryAccount: true },
    });
    if (user?.isRecoveryAccount) {
      throw new ForbiddenException(`The recovery account cannot be ${action}.`);
    }
  }

  // ------------------------------------------------------------------ reads

  /** Labels are stored lower-cased and trimmed so filtering is predictable. */
  private static normaliseTags(tags: readonly string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  }

  async list(query: {
    q?: string;
    role?: Role;
    status?: string;
    tags?: string;
    page?: number;
    size?: number;
  }) {
    const page = query.page ?? 1;
    const size = query.size ?? 50;
    const tags = UsersAdminService.normaliseTags(query.tags?.split(',') ?? []);

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status as Prisma.EnumUserStatusFilter['equals'] } : {}),
      // Any of them, not all: an administrator picking two shifts means both.
      ...(tags.length ? { tags: { hasSome: tags } } : {}),
      ...(query.q
        ? {
            OR: [
              { username: { contains: query.q.toLowerCase() } },
              { email: { contains: query.q.toLowerCase() } },
              { fullName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total, recoveryAccounts] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.user.count({ where }),
      // Counted across every account, not the current page: whether there is a
      // way back in is not a fact about whatever filter happens to be applied.
      this.prisma.user.count({
        where: { deletedAt: null, isRecoveryAccount: true, status: 'ACTIVE' },
      }),
    ]);

    return {
      items: rows.map(UsersService.toPublicUser),
      total,
      page,
      size,
      pages: Math.max(1, Math.ceil(total / size)),
      hasRecoveryAccount: recoveryAccounts > 0,
    };
  }

  /** One account with the context an administrator needs before acting. */
  async detail(id: string) {
    const user = await this.users.getByIdOrThrow(id);

    const [activeSessions, recentActivity, caseCounts] = await Promise.all([
      this.prisma.refreshToken.count({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.prisma.auditLog.findMany({
        where: { actorId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actorIp: true,
        },
      }),
      this.prisma.case.groupBy({
        by: ['status'],
        where: { assigneeId: id, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    return {
      user: UsersService.toPublicUser(user),
      activeSessions,
      lastLoginIp: user.lastLoginIp,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      failedLoginCount: user.failedLoginCount,
      createdAt: user.createdAt.toISOString(),
      assignedCases: Object.fromEntries(
        caseCounts.map((entry) => [entry.status, entry._count._all]),
      ),
      recentActivity: recentActivity.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ip: entry.actorIp,
        at: entry.createdAt.toISOString(),
      })),
    };
  }

  // ----------------------------------------------------------------- writes

  async update(
    id: string,
    input: {
      fullName?: string;
      email?: string;
      role?: Role;
      status?: 'ACTIVE' | 'DISABLED';
      tags?: string[];
    },
    actor: AdminActor,
  ): Promise<PublicUser> {
    const existing = await this.users.getByIdOrThrow(id);

    if (input.role && input.role !== existing.role) {
      await this.assertNotRecovery(id, 'moved off the administrator role');
      this.assertNotSelf(actor.id, id, 'change the role of');
      await this.assertNotLastAdmin(id, 'changing its role');
    }
    if (input.status === 'DISABLED') {
      await this.assertNotRecovery(id, 'disabled');
      this.assertNotSelf(actor.id, id, 'disable');
      await this.assertNotLastAdmin(id, 'disabling it');
    }

    let email = existing.email;
    if (input.email && normalizeEmail(input.email) !== existing.email) {
      const policy = await this.settings.getIdentityDomainPolicy();
      const check = validateEmailAgainstPolicy(input.email, policy);
      if (!check.ok) {
        throw new BadRequestException(
          check.reason === 'DOMAIN_MISMATCH'
            ? `E-mail must belong to the organisation domain ${formatDomainList(check.expectedDomains ?? [])}.`
            : 'E-mail address is not valid.',
        );
      }
      const clash = await this.prisma.user.findFirst({
        where: { email: check.email, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('E-mail already exists.');
      email = check.email;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
        email,
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.tags !== undefined ? { tags: UsersAdminService.normaliseTags(input.tags) } : {}),
      },
    });

    // A demotion or a disable must not leave live sessions behind carrying the
    // old rights: the guard reads the user on every request, but an open
    // session of a disabled account would otherwise linger until it expires.
    if (
      (input.role && input.role !== existing.role) ||
      (input.status && input.status !== existing.status)
    ) {
      await this.tokens.revokeAllForUser(id);
    }

    await this.audit.record({
      action:
        input.role && input.role !== existing.role ? AuditAction.ROLE_CHANGED : AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: {
        fullName: existing.fullName,
        email: existing.email,
        role: existing.role,
        status: existing.status,
        tags: existing.tags,
      },
      after: {
        fullName: updated.fullName,
        email: updated.email,
        role: updated.role,
        status: updated.status,
        tags: updated.tags,
      },
    });

    return UsersService.toPublicUser(updated);
  }

  async setEnabled(id: string, enabled: boolean, actor: AdminActor): Promise<PublicUser> {
    const existing = await this.users.getByIdOrThrow(id);
    if (!enabled) {
      await this.assertNotRecovery(id, 'disabled');
      this.assertNotSelf(actor.id, id, 'disable');
      await this.assertNotLastAdmin(id, 'disabling it');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        status: enabled ? 'ACTIVE' : 'DISABLED',
        ...(enabled ? { failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });

    const revoked = enabled ? 0 : await this.tokens.revokeAllForUser(id);

    await this.audit.record({
      action: enabled ? AuditAction.USER_ENABLED : AuditAction.USER_DISABLED,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { status: existing.status },
      after: { status: updated.status },
      metadata: { revokedSessions: revoked },
    });

    return UsersService.toPublicUser(updated);
  }

  /** Every label currently in use, so the filter can offer real choices. */
  async tagsInUse(): Promise<{ items: { name: string; count: number }[] }> {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, tags: { isEmpty: false } },
      select: { tags: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    return {
      items: [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  }

  /**
   * One reversible action across a selection.
   *
   * Accounts the actor is not allowed to touch are reported rather than
   * silently dropped — an administrator who disables forty accounts needs to
   * know that two of them did not move, and why. Nothing here throws on the
   * first refusal, because a partial batch is still worth finishing.
   */
  async bulk(
    input: {
      userIds: string[];
      action:
        'enable' | 'disable' | 'forceLogout' | 'addTags' | 'removeTags' | 'setRole' | 'delete';
      tags?: string[];
      role?: Role;
    },
    actor: AdminActor,
  ): Promise<{ changed: number; skipped: { id: string; reason: string }[] }> {
    const ids = [...new Set(input.userIds)];
    const tags = UsersAdminService.normaliseTags(input.tags ?? []);

    if ((input.action === 'addTags' || input.action === 'removeTags') && tags.length === 0) {
      throw new BadRequestException('Give at least one label.');
    }
    if (input.action === 'setRole' && !input.role) {
      throw new BadRequestException('Choose a role.');
    }

    const skipped: { id: string; reason: string }[] = [];
    let changed = 0;

    for (const id of ids) {
      try {
        if (input.action === 'enable' || input.action === 'disable') {
          await this.setEnabled(id, input.action === 'enable', actor);
        } else if (input.action === 'forceLogout') {
          await this.forceLogout(id, actor);
        } else if (input.action === 'delete') {
          await this.softDelete(id, actor);
        } else if (input.action === 'setRole') {
          // Through update(), so the same guards apply as when a role is
          // changed one account at a time: not your own, not the last
          // administrator, and every live session ends with the old rights.
          const existing = await this.users.getByIdOrThrow(id);
          if (existing.role === input.role) {
            skipped.push({ id, reason: `Already ${input.role}.` });
            continue;
          }
          await this.update(id, { role: input.role }, actor);
        } else {
          const existing = await this.users.getByIdOrThrow(id);
          const next =
            input.action === 'addTags'
              ? UsersAdminService.normaliseTags([...existing.tags, ...tags])
              : existing.tags.filter((tag) => !tags.includes(tag));

          if (next.length === existing.tags.length && input.action === 'removeTags') {
            skipped.push({ id, reason: 'None of those labels were set.' });
            continue;
          }

          const updated = await this.prisma.user.update({ where: { id }, data: { tags: next } });
          await this.audit.record({
            action: AuditAction.UPDATE,
            entityType: 'User',
            entityId: id,
            actorId: actor.id,
            actorIp: actor.ip,
            actorUserAgent: actor.userAgent,
            before: { tags: existing.tags },
            after: { tags: updated.tags },
          });
        }
        changed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not be changed.';
        skipped.push({
          id,
          // A row can sit in a stale list after somebody else removed the
          // account; "User not found" reads like a fault rather than an answer.
          reason: message === 'User not found' ? 'Already deleted.' : message,
        });
      }
    }

    return { changed, skipped };
  }

  async resetPassword(id: string, actor: AdminActor): Promise<{ temporaryPassword: string }> {
    const user = await this.users.getByIdOrThrow(id);
    const plain = temporaryPassword();
    const passwordHash = await this.passwords.hash(plain);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        status: user.status === 'LOCKED' ? 'ACTIVE' : user.status,
      },
    });
    await this.passwords.rememberPassword(id, passwordHash);
    const revoked = await this.tokens.revokeAllForUser(id);

    await this.audit.record({
      action: AuditAction.PASSWORD_RESET,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      metadata: { revokedSessions: revoked },
    });

    return { temporaryPassword: plain };
  }

  async forceLogout(id: string, actor: AdminActor): Promise<{ revokedSessions: number }> {
    await this.users.getByIdOrThrow(id);
    const revoked = await this.tokens.revokeAllForUser(id);

    await this.audit.record({
      action: AuditAction.SESSIONS_REVOKED,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      metadata: { revokedSessions: revoked },
    });

    return { revokedSessions: revoked };
  }

  /** Recovery path for a user who lost their authenticator device. */
  async resetTotp(id: string, actor: AdminActor): Promise<void> {
    const user = await this.users.getByIdOrThrow(id);
    if (!user.totpEnabled && !user.totpSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled on this account.');
    }

    await this.prisma.user.update({
      where: { id },
      data: { totpEnabled: false, totpSecret: null, totpRecoveryHash: [] },
    });

    await this.audit.record({
      action: AuditAction.TOTP_DISABLED,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      metadata: { byAdministrator: true },
    });
  }

  async softDelete(id: string, actor: AdminActor): Promise<void> {
    await this.assertNotRecovery(id, 'deleted');
    const user = await this.users.getByIdOrThrow(id);
    this.assertNotSelf(actor.id, id, 'delete');
    await this.assertNotLastAdmin(id, 'deleting it');

    const openCases = await this.prisma.case.count({
      where: { assigneeId: id, deletedAt: null, status: { notIn: ['RESOLVED', 'CLOSED'] } },
    });
    if (openCases > 0) {
      throw new ConflictException(
        `${openCases} open case(s) are still assigned to this account. Reassign them first.`,
      );
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISABLED' },
    });
    await this.tokens.revokeAllForUser(id);

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { username: user.username, email: user.email, role: user.role },
    });
  }

  // ------------------------------------------------------------- CSV import

  /**
   * Bulk account creation from a CSV.
   *
   * Rows are processed independently: one bad line in a 600-row roster must not
   * discard the other 599. `dryRun` validates everything and writes nothing,
   * which is how a 600-person import should always start.
   *
   * Columns: username (required), fullname, email (optional — derived from the
   * organisation domain when omitted), role.
   */
  async importCsv(
    csv: string,
    options: { dryRun: boolean; defaultRole: Role },
    actor: AdminActor,
  ): Promise<{
    dryRun: boolean;
    total: number;
    created: number;
    skipped: number;
    errors: number;
    rows: ImportRowResult[];
  }> {
    const parsed = parseCsv(csv);
    if (parsed.header.length === 0) {
      throw new BadRequestException('The file is empty.');
    }
    if (!parsed.header.includes('username')) {
      throw new BadRequestException('The header row must contain a "username" column.');
    }
    if (parsed.rows.length > 2_000) {
      throw new BadRequestException('At most 2000 rows per import.');
    }

    const column = (name: string) => parsed.header.indexOf(name);
    const usernameAt = column('username');
    const fullNameAt = column('fullname') !== -1 ? column('fullname') : column('full name');
    const emailAt = column('email');
    const roleAt = column('role');

    const policy = await this.settings.getIdentityDomainPolicy();
    const results: ImportRowResult[] = [];
    const seen = new Set<string>();

    for (const [index, row] of parsed.rows.entries()) {
      const line = index + 2; // header is line 1
      const username = normalizeUsername(row[usernameAt] ?? '');
      const fullName = (fullNameAt !== -1 ? row[fullNameAt] : '')?.trim() || username;
      const rawEmail = emailAt !== -1 ? row[emailAt]?.trim() : undefined;
      const rawRole = roleAt !== -1 ? row[roleAt]?.trim().toUpperCase() : undefined;

      const fail = (message: string) => results.push({ line, username, status: 'error', message });

      if (!username) {
        fail('Username is empty.');
        continue;
      }
      if (!isValidUsername(username)) {
        fail('Username must be 3-64 characters of letters, digits, dot, dash or underscore.');
        continue;
      }
      if (seen.has(username)) {
        results.push({ line, username, status: 'skipped', message: 'Duplicate row in this file.' });
        continue;
      }
      seen.add(username);

      const role = rawRole
        ? (Object.values(Role).find((value) => value === rawRole) ?? null)
        : options.defaultRole;
      if (!role) {
        fail(`Unknown role "${rawRole}".`);
        continue;
      }

      const email = rawEmail ? normalizeEmail(rawEmail) : buildEmailFromUsername(username, policy);
      if (!email) {
        fail('No e-mail given and no organisation domain configured.');
        continue;
      }
      const emailCheck = validateEmailAgainstPolicy(email, policy);
      if (!emailCheck.ok) {
        fail(
          emailCheck.reason === 'DOMAIN_MISMATCH'
            ? `E-mail must belong to ${formatDomainList(emailCheck.expectedDomains ?? [])}.`
            : 'E-mail address is not valid.',
        );
        continue;
      }

      const clash = await this.prisma.user.findFirst({
        where: { OR: [{ username }, { email: emailCheck.email }] },
        select: { username: true },
      });
      if (clash) {
        results.push({
          line,
          username,
          status: 'skipped',
          message:
            clash.username === username ? 'Username already exists.' : 'E-mail already exists.',
        });
        continue;
      }

      if (options.dryRun) {
        results.push({ line, username, status: 'created', email: emailCheck.email, role });
        continue;
      }

      const password = temporaryPassword();
      try {
        await this.users.create(
          { username, email: emailCheck.email, fullName, password, role },
          actor,
        );
        results.push({
          line,
          username,
          status: 'created',
          email: emailCheck.email,
          role,
          temporaryPassword: password,
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not create the account.');
      }
    }

    const summary = {
      dryRun: options.dryRun,
      total: parsed.rows.length,
      created: results.filter((row) => row.status === 'created').length,
      skipped: results.filter((row) => row.status === 'skipped').length,
      errors: results.filter((row) => row.status === 'error').length,
      rows: results,
    };

    if (!options.dryRun) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: 'UserImport',
        actorId: actor.id,
        actorIp: actor.ip,
        actorUserAgent: actor.userAgent,
        metadata: {
          total: summary.total,
          created: summary.created,
          skipped: summary.skipped,
          errors: summary.errors,
        },
      });
    }

    return summary;
  }

  /** Not exported to CSV by accident: only ids and metadata, never secrets. */
  static toDirectoryRow(user: User) {
    return [user.username, user.fullName, user.email, user.role, user.status];
  }
}
