import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import {
  AuditAction,
  IdentityProvider,
  Role,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
  validateEmailAgainstPolicy,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import {
  ScimException,
  SCIM_LIST_SCHEMA,
  SCIM_USER_SCHEMA,
  coerceBoolean,
  parseFilter,
  type ScimListResponse,
  type ScimUser,
} from './scim.types';

export interface ScimActor {
  keyId: string;
  keyName: string;
  ip: string | null;
  userAgent: string | null;
}

/** Entra never sends more than 100 at a time; the cap is defensive. */
const MAX_PAGE = 200;

/**
 * SCIM 2.0 provisioning.
 *
 * The directory becomes the source of truth for who exists, but not for this
 * system's safety rails. Two things it can never do, no matter what it sends:
 * take away the break-glass account, or deactivate the last administrator.
 * Both would leave an organisation locked out of its own SOC platform because
 * of an HR record change.
 *
 * Nothing here deletes. Cases carry `reporterId` and `assigneeId`; removing the
 * row behind a year of investigations to reflect a leaver would destroy the
 * history those investigations are for. A departure deactivates.
 */
@Injectable()
export class ScimService {
  private readonly logger = new Logger(ScimService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------- projection

  static toScim(user: User, baseUrl: string): ScimUser {
    const [givenName, ...rest] = user.fullName.split(' ');
    return {
      schemas: [SCIM_USER_SCHEMA],
      id: user.id,
      ...(user.scimExternalId ? { externalId: user.scimExternalId } : {}),
      userName: user.email,
      name: {
        formatted: user.fullName,
        givenName: givenName || user.fullName,
        familyName: rest.join(' '),
      },
      displayName: user.fullName,
      emails: [{ value: user.email, type: 'work', primary: true }],
      active: user.status !== 'DISABLED' && user.deletedAt === null,
      meta: {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
        location: `${baseUrl}/Users/${user.id}`,
      },
    };
  }

  // ------------------------------------------------------------------ reads

  async list(
    query: { filter?: string; startIndex?: string; count?: string },
    baseUrl: string,
  ): Promise<ScimListResponse<ScimUser>> {
    const filter = parseFilter(query.filter);
    const startIndex = Math.max(1, Number(query.startIndex ?? 1) || 1);
    const count = Math.min(MAX_PAGE, Math.max(0, Number(query.count ?? 100) || 100));

    const where: Prisma.UserWhereInput = filter ? this.whereFor(filter) : {};

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: startIndex - 1,
        take: count,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: total,
      itemsPerPage: rows.length,
      startIndex,
      Resources: rows.map((row) => ScimService.toScim(row, baseUrl)),
    };
  }

  private whereFor(filter: { attribute: string; value: string }): Prisma.UserWhereInput {
    switch (filter.attribute) {
      case 'username':
      case 'emails.value':
      case 'emails':
        return { email: normalizeEmail(filter.value) };
      case 'externalid':
        return { scimExternalId: filter.value };
      case 'id':
        return { id: filter.value };
      case 'active': {
        const active = coerceBoolean(filter.value);
        return active === false
          ? { OR: [{ status: 'DISABLED' }, { NOT: { deletedAt: null } }] }
          : { status: { not: 'DISABLED' }, deletedAt: null };
      }
      default:
        throw new ScimException(
          400,
          `Filtering on '${filter.attribute}' is not supported.`,
          'invalidFilter',
        );
    }
  }

  async get(id: string, baseUrl: string): Promise<ScimUser> {
    return ScimService.toScim(await this.findOrThrow(id), baseUrl);
  }

  private async findOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new ScimException(404, `No user with id ${id}.`);
    return user;
  }

  // ----------------------------------------------------------------- writes

  async create(body: Record<string, unknown>, actor: ScimActor, baseUrl: string): Promise<ScimUser> {
    const userName = readString(body, 'userName');
    if (!userName) {
      throw new ScimException(400, 'userName is required.', 'invalidValue');
    }

    const email = normalizeEmail(readEmail(body) ?? userName);
    await this.assertWithinOrganisationDomain(email);

    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) {
      /*
       * The spec asks for 409 here, and Entra reacts to it correctly: it stops
       * trying to create and reconciles against the record it can already see.
       */
      throw new ScimException(409, `A user with userName ${email} already exists.`, 'uniqueness');
    }

    const policy = await this.settings.getAuthPolicy();
    const created = await this.prisma.user.create({
      data: {
        username: await this.availableUsername(userName, email),
        email,
        fullName: readDisplayName(body) ?? email,
        // Provisioned accounts authenticate at the directory, never here.
        passwordHash: null,
        mustChangePassword: false,
        /*
         * The floor, not a guess. Provisioning says a person exists; it does
         * not say what they may do. An unmapped account that arrives able to
         * read nothing is recoverable; one that arrives able to act is not.
         */
        role: policy.defaultRole ?? Role.READ_ONLY,
        status: readActive(body) === false ? 'DISABLED' : 'ACTIVE',
        identityProvider: IdentityProvider.OIDC,
        scimExternalId: readString(body, 'externalId') ?? null,
        provisionedAt: new Date(),
      },
    });

    await this.record(AuditAction.USER_PROVISIONED, created, actor, {
      reason: 'SCIM_CREATE',
      after: { username: created.username, email: created.email, role: created.role },
    });

    return ScimService.toScim(created, baseUrl);
  }

  /** PUT: the directory sends the whole resource as it believes it should be. */
  async replace(
    id: string,
    body: Record<string, unknown>,
    actor: ScimActor,
    baseUrl: string,
  ): Promise<ScimUser> {
    const user = await this.findOrThrow(id);
    const active = readActive(body);
    const email = readEmail(body) ?? readString(body, 'userName');

    if (email && normalizeEmail(email) !== user.email) {
      await this.assertWithinOrganisationDomain(normalizeEmail(email));
    }

    return this.applyChanges(
      user,
      {
        ...(email ? { email: normalizeEmail(email) } : {}),
        ...(readDisplayName(body) ? { fullName: readDisplayName(body)! } : {}),
        ...(readString(body, 'externalId') ? { scimExternalId: readString(body, 'externalId')! } : {}),
        ...(active === null ? {} : { active }),
      },
      actor,
      baseUrl,
      'SCIM_REPLACE',
    );
  }

  /**
   * PATCH: how a directory actually says "this person has left".
   *
   * Both shapes are accepted because both are sent in the wild: an operation
   * with `path: "active"`, and one with no path whose value is an object.
   */
  async patch(
    id: string,
    body: Record<string, unknown>,
    actor: ScimActor,
    baseUrl: string,
  ): Promise<ScimUser> {
    const user = await this.findOrThrow(id);
    const operations = body.Operations ?? body.operations;
    if (!Array.isArray(operations)) {
      throw new ScimException(400, 'PatchOp requires an Operations array.', 'invalidSyntax');
    }

    const changes: PendingChanges = {};

    for (const raw of operations) {
      if (typeof raw !== 'object' || raw === null) continue;
      const operation = raw as Record<string, unknown>;
      const op = String(operation.op ?? '').toLowerCase();
      if (op === 'remove') continue;

      const path = String(operation.path ?? '').toLowerCase();
      const value = operation.value;

      if (path === 'active') {
        const active = coerceBoolean(value);
        if (active !== null) changes.active = active;
        continue;
      }
      if (path === 'displayname' && typeof value === 'string') {
        changes.fullName = value;
        continue;
      }
      if ((path === 'username' || path === 'emails[type eq "work"].value') && typeof value === 'string') {
        changes.email = normalizeEmail(value);
        continue;
      }
      if (path === 'externalid' && typeof value === 'string') {
        changes.scimExternalId = value;
        continue;
      }

      if (!path && typeof value === 'object' && value !== null) {
        const nested = value as Record<string, unknown>;
        const active = coerceBoolean(nested.active);
        if (active !== null) changes.active = active;
        const display = readDisplayName(nested);
        if (display) changes.fullName = display;
        const nestedEmail = readEmail(nested) ?? readString(nested, 'userName');
        if (nestedEmail) changes.email = normalizeEmail(nestedEmail);
        const external = readString(nested, 'externalId');
        if (external) changes.scimExternalId = external;
      }
    }

    if (changes.email && changes.email !== user.email) {
      await this.assertWithinOrganisationDomain(changes.email);
    }

    return this.applyChanges(user, changes, actor, baseUrl, 'SCIM_PATCH');
  }

  /**
   * DELETE deactivates; it does not remove.
   *
   * A directory deleting a person means they have left, not that a year of
   * their case history should stop having an owner. Cases reference users, so
   * the row stays and the account stops working — which is what "gone" means
   * for a system of record.
   */
  async deactivate(id: string, actor: ScimActor): Promise<void> {
    const user = await this.findOrThrow(id);
    await this.applyChanges(user, { active: false }, actor, '', 'SCIM_DELETE');
  }

  // ---------------------------------------------------------------- helpers

  private async applyChanges(
    user: User,
    changes: PendingChanges,
    actor: ScimActor,
    baseUrl: string,
    reason: string,
  ): Promise<ScimUser> {
    if (changes.active === false) await this.assertMayDeactivate(user);

    if (changes.email && changes.email !== user.email) {
      const clash = await this.prisma.user.findFirst({
        where: { email: changes.email, id: { not: user.id } },
        select: { id: true },
      });
      if (clash) {
        throw new ScimException(409, `Another user already has ${changes.email}.`, 'uniqueness');
      }
    }

    const data: Prisma.UserUpdateInput = {
      ...(changes.email ? { email: changes.email } : {}),
      ...(changes.fullName ? { fullName: changes.fullName } : {}),
      ...(changes.scimExternalId ? { scimExternalId: changes.scimExternalId } : {}),
      ...(changes.active === undefined
        ? {}
        : changes.active
          ? { status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null }
          : { status: 'DISABLED' }),
      provisionedAt: new Date(),
    };

    const updated = await this.prisma.user.update({ where: { id: user.id }, data });

    if (changes.active === false) {
      /* A departure has to end the sessions too, or the person keeps working
       * until an access token happens to expire. */
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.record(AuditAction.USER_PROVISIONED, updated, actor, {
      reason,
      before: { email: user.email, fullName: user.fullName, status: user.status },
      after: { email: updated.email, fullName: updated.fullName, status: updated.status },
    });

    return ScimService.toScim(updated, baseUrl);
  }

  /**
   * The two things a directory may not do here.
   *
   * These are absolute rather than conditional on how the tenant is set up: a
   * group membership changing in HR must never be able to remove the last way
   * into this system.
   */
  private async assertMayDeactivate(user: User): Promise<void> {
    if (user.isRecoveryAccount) {
      throw new ScimException(
        403,
        'This is the break-glass account; it cannot be deactivated from the directory.',
        'mutability',
      );
    }

    if (user.role === Role.ADMIN && user.status === 'ACTIVE') {
      const otherAdmins = await this.prisma.user.count({
        where: { role: Role.ADMIN, status: 'ACTIVE', deletedAt: null, id: { not: user.id } },
      });
      if (otherAdmins === 0) {
        throw new ScimException(
          403,
          'This is the last active administrator; deactivating it would lock everyone out.',
          'mutability',
        );
      }
    }
  }

  /** D9 holds here too: a locked organisation domain is not bypassed by a sync. */
  private async assertWithinOrganisationDomain(email: string): Promise<void> {
    const domainPolicy = await this.settings.getIdentityDomainPolicy();
    const check = validateEmailAgainstPolicy(email, domainPolicy);
    if (check.ok) return;

    throw new ScimException(
      400,
      check.reason === 'DOMAIN_MISMATCH'
        ? `${email} is outside the organisation domain @${check.expectedDomain}.`
        : `${email} is not a valid address.`,
      'invalidValue',
    );
  }

  private async availableUsername(preferred: string, email: string): Promise<string> {
    const candidateBase = normalizeUsername((preferred.split('@')[0] ?? '').trim());
    const fallback = normalizeUsername(email.split('@')[0] ?? '');
    const base = isValidUsername(candidateBase)
      ? candidateBase
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

  /**
   * Attributed to the key, not to a person.
   *
   * `actorId` stays null because no user did this; who did it is the
   * integration, and that belongs in metadata where it can name the key.
   */
  private async record(
    action: AuditAction,
    user: User,
    actor: ScimActor,
    detail: { reason: string; before?: unknown; after?: unknown },
  ): Promise<void> {
    await this.audit.record({
      action,
      entityType: 'User',
      entityId: user.id,
      actorId: null,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: detail.before,
      after: detail.after,
      metadata: { via: 'SCIM', apiKeyId: actor.keyId, apiKeyName: actor.keyName, reason: detail.reason },
    });
  }
}

interface PendingChanges {
  email?: string;
  fullName?: string;
  scimExternalId?: string;
  active?: boolean;
}

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readActive(body: Record<string, unknown>): boolean | null {
  return coerceBoolean(body.active);
}

function readDisplayName(body: Record<string, unknown>): string | null {
  const display = readString(body, 'displayName');
  if (display) return display;

  const name = body.name;
  if (typeof name === 'object' && name !== null) {
    const parts = name as Record<string, unknown>;
    const formatted = readString(parts, 'formatted');
    if (formatted) return formatted;

    const given = readString(parts, 'givenName');
    const family = readString(parts, 'familyName');
    const joined = [given, family].filter(Boolean).join(' ');
    if (joined) return joined;
  }
  return null;
}

function readEmail(body: Record<string, unknown>): string | null {
  const emails = body.emails;
  if (!Array.isArray(emails)) return null;

  const entries = emails.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  );
  const primary = entries.find((entry) => entry.primary === true) ?? entries[0];
  return primary ? readString(primary, 'value') : null;
}
