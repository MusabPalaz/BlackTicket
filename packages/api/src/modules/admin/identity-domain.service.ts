import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditAction,
  type IdentityDomainPolicy,
  isValidDomain,
  normalizeDomain,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';

export interface DomainPolicyView extends IdentityDomainPolicy {
  /** Accounts whose address sits outside the configured domain. */
  mismatchedUsers: number;
  totalUsers: number;
}

interface Actor {
  id: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * The organisation e-mail domain.
 *
 * An administrator sets it once and locks it; from then on every account, and
 * every row of a CSV import, must fall inside that domain. Locking is what
 * turns the setting from a convention into a constraint — so unlocking is a
 * separate, re-authenticated and audited action rather than another form field.
 */
@Injectable()
export class IdentityDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async view(): Promise<DomainPolicyView> {
    const policy = await this.settings.getIdentityDomainPolicy();
    return { ...policy, ...(await this.countMismatches(policy.domain)) };
  }

  private async countMismatches(
    domain: string | null,
  ): Promise<{ mismatchedUsers: number; totalUsers: number }> {
    const totalUsers = await this.prisma.user.count({ where: { deletedAt: null } });
    if (!domain) return { mismatchedUsers: 0, totalUsers };

    const mismatchedUsers = await this.prisma.user.count({
      where: { deletedAt: null, NOT: { email: { endsWith: `@${normalizeDomain(domain)}` } } },
    });
    return { mismatchedUsers, totalUsers };
  }

  async setDomain(domain: string, confirmDomain: string, actor: Actor): Promise<DomainPolicyView> {
    const current = await this.settings.getIdentityDomainPolicy();
    if (current.locked) {
      throw new ConflictException(
        'The organisation domain is locked. Unlock it first to make a change.',
      );
    }

    const normalized = normalizeDomain(domain);
    if (normalizeDomain(confirmDomain) !== normalized) {
      throw new BadRequestException('The two domain entries do not match.');
    }
    if (!isValidDomain(normalized)) {
      throw new BadRequestException(
        'Enter a valid domain such as blackticket.local — no scheme, no "@", no path.',
      );
    }

    const updated: IdentityDomainPolicy = {
      domain: normalized,
      locked: false,
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };
    await this.settings.setIdentityDomainPolicy(updated);

    await this.audit.record({
      action: AuditAction.DOMAIN_POLICY_CHANGED,
      entityType: 'SystemSetting',
      entityId: 'identity.emailDomain',
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: current,
      after: updated,
    });

    return { ...updated, ...(await this.countMismatches(normalized)) };
  }

  async lock(
    confirmDomain: string,
    acknowledgeMismatch: boolean,
    actor: Actor,
  ): Promise<DomainPolicyView> {
    const current = await this.settings.getIdentityDomainPolicy();

    if (!current.domain) {
      throw new BadRequestException('Set the organisation domain before locking it.');
    }
    if (current.locked) {
      return this.view();
    }
    if (normalizeDomain(confirmDomain) !== normalizeDomain(current.domain)) {
      throw new BadRequestException('The confirmation does not match the configured domain.');
    }

    const counts = await this.countMismatches(current.domain);
    if (counts.mismatchedUsers > 0 && !acknowledgeMismatch) {
      // Locking with mismatched accounts is legal but rarely intended, so it
      // has to be an explicit choice rather than a surprise.
      throw new ConflictException({
        message: `${counts.mismatchedUsers} existing account(s) are outside @${normalizeDomain(current.domain)}. Re-submit with acknowledgeMismatch to lock anyway.`,
        code: 'DOMAIN_MISMATCH_PRESENT',
        mismatchedUsers: counts.mismatchedUsers,
      });
    }

    const updated: IdentityDomainPolicy = {
      ...current,
      locked: true,
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };
    await this.settings.setIdentityDomainPolicy(updated);

    await this.audit.record({
      action: AuditAction.DOMAIN_POLICY_LOCKED,
      entityType: 'SystemSetting',
      entityId: 'identity.emailDomain',
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: current,
      after: updated,
      metadata: { mismatchedUsers: counts.mismatchedUsers },
    });

    return { ...updated, ...counts };
  }

  async unlock(password: string, reason: string, actor: Actor): Promise<DomainPolicyView> {
    const account = await this.users.getByIdOrThrow(actor.id);

    /*
     * Unlocking stays password-verified even under SSO. The account that does
     * it is the break-glass one, which keeps a local password precisely so a
     * decision this consequential cannot ride on a federated session alone.
     * An account without one is told that, rather than that it typed its
     * password wrongly.
     */
    if (account.passwordHash === null) {
      throw new UnauthorizedException(
        'This account has no local password. Unlock the domain from the break-glass account.',
      );
    }
    if (!(await this.passwords.verifyLocal(account.passwordHash, password))) {
      throw new UnauthorizedException('Password is incorrect');
    }

    const current = await this.settings.getIdentityDomainPolicy();
    if (!current.locked) {
      return this.view();
    }

    const updated: IdentityDomainPolicy = {
      ...current,
      locked: false,
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };
    await this.settings.setIdentityDomainPolicy(updated);

    await this.audit.record({
      action: AuditAction.DOMAIN_POLICY_UNLOCKED,
      entityType: 'SystemSetting',
      entityId: 'identity.emailDomain',
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: current,
      after: updated,
      metadata: { reason },
    });

    return { ...updated, ...(await this.countMismatches(current.domain)) };
  }
}
