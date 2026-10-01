import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  AuditAction,
  IdentityProvider,
  Role,
  formatDomainList,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
  resolveRoleFromGroups,
  validateEmailAgainstPolicy,
  type AuthPolicy,
} from '@black-ticket/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SettingsService } from '../../settings/settings.service';

/** What the provider told us about the person signing in. */
export interface FederatedIdentity {
  issuer: string;
  subject: string;
  username: string;
  email: string;
  fullName: string;
  groups: string[];
}

export interface ProvisionContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Turns an assertion from the identity provider into a local account.
 *
 * The directory owns who exists and what role they hold, but it does not own
 * this system's safety rails: the break-glass account is never touched, an
 * account an administrator disabled here stays disabled, and the organisation
 * domain still applies. A directory is a source of truth about people, not a
 * licence to overwrite local decisions.
 */
@Injectable()
export class SsoProvisioningService {
  private readonly logger = new Logger(SsoProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async resolve(
    identity: FederatedIdentity,
    policy: AuthPolicy,
    context: ProvisionContext,
  ): Promise<User> {
    const email = normalizeEmail(identity.email);
    const username = normalizeUsername(identity.username);

    await this.assertWithinOrganisationDomain(email, identity, context);

    const role = resolveRoleFromGroups(policy, identity.groups);
    if (role === null) {
      await this.deny(identity, context, 'NO_ROLE_MAPPING');
      throw new ForbiddenException(
        'Your directory groups do not grant access to this system. Ask an administrator.',
      );
    }

    const linked = await this.prisma.user.findFirst({
      where: { externalIssuer: identity.issuer, externalId: identity.subject },
    });
    if (linked) return this.refresh(linked, { email, username, role }, identity, context);

    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) return this.link(existing, { username, role }, identity, context);

    return this.create({ email, username, role }, identity, context);
  }

  /**
   * D9 still holds under SSO: a locked organisation domain applies to whoever
   * the directory sends. A tenant with guest accounts from other domains would
   * otherwise find the lock quietly bypassed by federation.
   */
  private async assertWithinOrganisationDomain(
    email: string,
    identity: FederatedIdentity,
    context: ProvisionContext,
  ): Promise<void> {
    const domainPolicy = await this.settings.getIdentityDomainPolicy();
    const check = validateEmailAgainstPolicy(email, domainPolicy);
    if (check.ok) return;

    await this.deny(identity, context, 'DOMAIN_MISMATCH');
    throw new ForbiddenException(
      check.reason === 'DOMAIN_MISMATCH'
        ? `Your address is outside the organisation domain ${formatDomainList(check.expectedDomains ?? [])}.`
        : 'The identity provider supplied an address this system cannot accept.',
    );
  }

  /** An account an administrator switched off here does not come back because
   *  the directory still lists the person. */
  private async assertUsable(
    user: User,
    identity: FederatedIdentity,
    context: ProvisionContext,
  ): Promise<void> {
    if (user.deletedAt) {
      await this.deny(identity, context, 'ACCOUNT_DELETED');
      throw new ForbiddenException('This account has been removed.');
    }
    if (user.status === 'DISABLED') {
      await this.deny(identity, context, 'ACCOUNT_DISABLED');
      throw new ForbiddenException('This account is disabled in Black Ticket.');
    }
  }

  private async refresh(
    user: User,
    next: { email: string; username: string; role: Role },
    identity: FederatedIdentity,
    context: ProvisionContext,
  ): Promise<User> {
    await this.assertUsable(user, identity, context);

    const role = await this.roleToApply(user, next.role);
    const changed =
      user.email !== next.email ||
      user.fullName !== identity.fullName ||
      user.role !== role ||
      user.status !== 'ACTIVE';

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: next.email,
        fullName: identity.fullName || user.fullName,
        role,
        // A locked-out account clears on a successful federated sign-in: the
        // lockout counts local password attempts, which is not what happened.
        status: 'ACTIVE',
        failedLoginCount: 0,
        lockedUntil: null,
        provisionedAt: new Date(),
      },
    });

    if (changed) {
      await this.audit.record({
        action: AuditAction.USER_PROVISIONED,
        entityType: 'User',
        entityId: user.id,
        actorId: user.id,
        actorIp: context.ip,
        actorUserAgent: context.userAgent,
        before: { email: user.email, fullName: user.fullName, role: user.role, status: user.status },
        after: { email: updated.email, fullName: updated.fullName, role: updated.role, status: updated.status },
        metadata: { issuer: identity.issuer, reason: 'REFRESH' },
      });
    }

    return updated;
  }

  /**
   * An account that already exists under the same address is adopted rather
   * than duplicated. Its password hash is deliberately left in place: dropping
   * it would strand the account if the tenant later switches SSO off.
   */
  private async link(
    user: User,
    next: { username: string; role: Role },
    identity: FederatedIdentity,
    context: ProvisionContext,
  ): Promise<User> {
    await this.assertUsable(user, identity, context);

    const role = await this.roleToApply(user, next.role);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        identityProvider: IdentityProvider.OIDC,
        externalIssuer: identity.issuer,
        externalId: identity.subject,
        fullName: identity.fullName || user.fullName,
        role,
        status: 'ACTIVE',
        failedLoginCount: 0,
        lockedUntil: null,
        provisionedAt: new Date(),
      },
    });

    await this.audit.record({
      action: AuditAction.USER_PROVISIONED,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
      before: { identityProvider: user.identityProvider, role: user.role },
      after: { identityProvider: updated.identityProvider, role: updated.role },
      metadata: { issuer: identity.issuer, reason: 'LINKED_EXISTING' },
    });

    return updated;
  }

  private async create(
    next: { email: string; username: string; role: Role },
    identity: FederatedIdentity,
    context: ProvisionContext,
  ): Promise<User> {
    const username = await this.availableUsername(next.username, next.email);

    const created = await this.prisma.user.create({
      data: {
        username,
        email: next.email,
        fullName: identity.fullName || username,
        // No local password at all: this account authenticates at the provider.
        passwordHash: null,
        mustChangePassword: false,
        role: next.role,
        status: 'ACTIVE',
        identityProvider: IdentityProvider.OIDC,
        externalIssuer: identity.issuer,
        externalId: identity.subject,
        provisionedAt: new Date(),
      },
    });

    await this.audit.record({
      action: AuditAction.USER_PROVISIONED,
      entityType: 'User',
      entityId: created.id,
      actorId: created.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
      after: { username: created.username, email: created.email, role: created.role },
      metadata: { issuer: identity.issuer, reason: 'CREATED' },
    });

    return created;
  }

  /**
   * The role the directory asks for, unless applying it would break something
   * the directory has no business breaking.
   */
  private async roleToApply(user: User, requested: Role): Promise<Role> {
    if (user.role === requested) return requested;

    /*
     * The break-glass account's role is absolute — a directory group rename
     * must never be able to take the last way back in.
     */
    if (user.isRecoveryAccount) {
      this.logger.warn(
        `Directory asked for role ${requested} on the recovery account ${user.username}; kept ${user.role}.`,
      );
      return user.role;
    }

    if (user.role === Role.ADMIN && requested !== Role.ADMIN) {
      const otherAdmins = await this.prisma.user.count({
        where: { role: Role.ADMIN, status: 'ACTIVE', deletedAt: null, id: { not: user.id } },
      });
      if (otherAdmins === 0) {
        this.logger.warn(
          `Directory would demote the last administrator ${user.username} to ${requested}; kept ADMIN.`,
        );
        return user.role;
      }
    }

    return requested;
  }

  /**
   * The provider's sign-in name is only a suggestion. It can collide with a
   * local account or be unusable as a username, and neither is a reason to
   * refuse someone the directory vouches for.
   */
  private async availableUsername(preferred: string, email: string): Promise<string> {
    const fallback = normalizeUsername(email.split('@')[0] ?? '');
    const base = isValidUsername(preferred)
      ? preferred
      : isValidUsername(fallback)
        ? fallback
        : `user-${Date.now().toString(36)}`;

    for (let suffix = 0; suffix < 50; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix}`;
      const taken = await this.prisma.user.findFirst({
        where: { username: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }

    return `${base}-${Date.now().toString(36)}`;
  }

  private async deny(
    identity: FederatedIdentity,
    context: ProvisionContext,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      action: AuditAction.SSO_LOGIN_DENIED,
      entityType: 'User',
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
      metadata: {
        reason,
        issuer: identity.issuer,
        subject: identity.subject,
        email: identity.email,
      },
    });
  }
}
