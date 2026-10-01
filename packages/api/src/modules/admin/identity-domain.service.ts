import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditAction,
  type IdentityDomainPolicy,
  MAX_ADDITIONAL_DOMAINS,
  isValidDomain,
  normalizeDomain,
  organisationDomains,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';

export interface DomainPolicyView extends IdentityDomainPolicy {
  additionalDomains: string[];
  /** Accounts whose address sits outside every configured domain. */
  mismatchedUsers: number;
  totalUsers: number;
}

interface Actor {
  id: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * The organisation e-mail domains: one primary, plus any others the same
 * organisation mails from (one directory tenant often serves several).
 *
 * They apply from the moment they are saved: every account, and every row of a
 * CSV import, must fall inside one of them. Locking freezes the list, so that
 * changing who may hold an account takes a separate, re-authenticated and
 * audited unlock rather than another form field. The lock covers the whole
 * list: adding a domain widens who may get an account just as surely as
 * changing the primary does.
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
    return this.present(await this.settings.getIdentityDomainPolicy());
  }

  private async present(policy: IdentityDomainPolicy): Promise<DomainPolicyView> {
    return {
      ...policy,
      additionalDomains: policy.additionalDomains ?? [],
      ...(await this.countMismatches(policy)),
    };
  }

  private async countMismatches(
    policy: IdentityDomainPolicy,
  ): Promise<{ mismatchedUsers: number; totalUsers: number }> {
    const totalUsers = await this.prisma.user.count({ where: { deletedAt: null } });
    const domains = organisationDomains(policy);
    if (domains.length === 0) return { mismatchedUsers: 0, totalUsers };

    const mismatchedUsers = await this.prisma.user.count({
      where: {
        deletedAt: null,
        NOT: { OR: domains.map((domain) => ({ email: { endsWith: `@${domain}` } })) },
      },
    });
    return { mismatchedUsers, totalUsers };
  }

  private async assertUnlocked(): Promise<IdentityDomainPolicy> {
    const current = await this.settings.getIdentityDomainPolicy();
    if (current.locked) {
      throw new ConflictException(
        'The organisation domains are locked. Unlock them first to make a change.',
      );
    }
    return current;
  }

  /** Same entry twice, then shape: a typo in a domain is a lockout waiting to happen. */
  private confirmedDomain(domain: string, confirmDomain: string): string {
    const normalized = normalizeDomain(domain);
    if (normalizeDomain(confirmDomain) !== normalized) {
      throw new BadRequestException('The two domain entries do not match.');
    }
    if (!isValidDomain(normalized)) {
      throw new BadRequestException(
        'Enter a valid domain such as blackticket.local — no scheme, no "@", no path.',
      );
    }
    return normalized;
  }

  private async save(
    current: IdentityDomainPolicy,
    updated: IdentityDomainPolicy,
    actor: Actor,
    metadata?: Record<string, unknown>,
  ): Promise<DomainPolicyView> {
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
      metadata,
    });

    return this.present(updated);
  }

  /** Sets or replaces the primary domain. The additional ones are kept, minus
   *  this one if it was among them. */
  async setDomain(domain: string, confirmDomain: string, actor: Actor): Promise<DomainPolicyView> {
    const current = await this.assertUnlocked();
    const normalized = this.confirmedDomain(domain, confirmDomain);

    const updated: IdentityDomainPolicy = {
      domain: normalized,
      additionalDomains: (current.additionalDomains ?? []).filter((d) => d !== normalized),
      locked: false,
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };
    return this.save(current, updated, actor);
  }

  async addDomain(domain: string, confirmDomain: string, actor: Actor): Promise<DomainPolicyView> {
    const current = await this.assertUnlocked();
    if (!current.domain) {
      throw new BadRequestException('Set the primary domain before adding others.');
    }
    const normalized = this.confirmedDomain(domain, confirmDomain);

    const additional = current.additionalDomains ?? [];
    if (organisationDomains(current).includes(normalized)) {
      throw new ConflictException(`@${normalized} is already an organisation domain.`);
    }
    if (additional.length >= MAX_ADDITIONAL_DOMAINS) {
      throw new BadRequestException(
        `At most ${MAX_ADDITIONAL_DOMAINS} additional domains can be configured.`,
      );
    }

    const updated: IdentityDomainPolicy = {
      ...current,
      additionalDomains: [...additional, normalized],
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };
    return this.save(current, updated, actor, { added: normalized });
  }

  /**
   * No new account can be made in the removed domain. Existing ones there keep
   * signing in with a local password, but single sign-on checks the domain on
   * every sign-in and refuses them — the same as for any other address outside
   * the policy.
   */
  async removeDomain(domain: string, actor: Actor): Promise<DomainPolicyView> {
    const current = await this.assertUnlocked();
    const normalized = normalizeDomain(domain);

    if (current.domain && normalized === normalizeDomain(current.domain)) {
      throw new BadRequestException('The primary domain cannot be removed. Change it instead.');
    }
    const additional = current.additionalDomains ?? [];
    if (!additional.includes(normalized)) {
      throw new NotFoundException(`@${normalized} is not an additional organisation domain.`);
    }

    const updated: IdentityDomainPolicy = {
      ...current,
      additionalDomains: additional.filter((d) => d !== normalized),
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };
    return this.save(current, updated, actor, { removed: normalized });
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
      throw new BadRequestException('The confirmation does not match the primary domain.');
    }

    const counts = await this.countMismatches(current);
    if (counts.mismatchedUsers > 0 && !acknowledgeMismatch) {
      // Locking with mismatched accounts is legal but rarely intended, so it
      // has to be an explicit choice rather than a surprise.
      throw new ConflictException({
        message: `${counts.mismatchedUsers} existing account(s) are outside the organisation domains. Re-submit with acknowledgeMismatch to lock anyway.`,
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

    return { ...updated, additionalDomains: updated.additionalDomains ?? [], ...counts };
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

    return this.present(updated);
  }
}
