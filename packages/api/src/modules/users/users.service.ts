import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  AuditAction,
  type Permission,
  ROLE_PERMISSIONS,
  type Role,
  buildEmailFromUsername,
  formatDomainList,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
  validateEmailAgainstPolicy,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  /** Free-text labels used to group and filter accounts. */
  tags: string[];
  /** The break-glass administrator; protected from deletion and demotion. */
  isRecoveryAccount: boolean;
  permissions: readonly Permission[];
}

export interface CreateUserInput {
  username: string;
  /** Optional: derived as `<username>@<configured domain>` when omitted. */
  email?: string;
  fullName: string;
  password: string;
  role: Role;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  static toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role as Role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      totpEnabled: user.totpEnabled,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      tags: user.tags,
      isRecoveryAccount: user.isRecoveryAccount,
      permissions: ROLE_PERMISSIONS[user.role as Role],
    };
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { username: normalizeUsername(username), deletedAt: null },
    });
  }

  async getByIdOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * The single account-creation path.
   *
   * Everything that creates users — the admin form, the CSV import, automated
   * provisioning — goes through here, so the e-mail domain policy cannot be
   * bypassed by adding a new entry point later.
   */
  async create(
    input: CreateUserInput,
    actor: { id: string; ip?: string | null; userAgent?: string | null } | null,
  ): Promise<PublicUser> {
    const username = normalizeUsername(input.username);

    if (!isValidUsername(username)) {
      throw new BadRequestException(
        'Username must be 3-64 characters using letters, digits, dot, dash or underscore.',
      );
    }

    const policy = await this.settings.getIdentityDomainPolicy();
    const requestedEmail = input.email
      ? normalizeEmail(input.email)
      : buildEmailFromUsername(username, policy);

    if (!requestedEmail) {
      throw new BadRequestException(
        'No e-mail address supplied and no organisation domain is configured yet.',
      );
    }

    const emailCheck = validateEmailAgainstPolicy(requestedEmail, policy);
    if (!emailCheck.ok) {
      throw new BadRequestException(
        emailCheck.reason === 'DOMAIN_MISMATCH'
          ? `E-mail must belong to the organisation domain ${formatDomainList(emailCheck.expectedDomains ?? [])}.`
          : 'E-mail address is not valid.',
      );
    }

    const strength = this.passwords.checkStrength(input.password, {
      username,
      email: emailCheck.email,
      fullName: input.fullName,
    });
    if (!strength.ok) {
      throw new BadRequestException(strength.message);
    }

    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email: emailCheck.email }] },
      select: { username: true, email: true },
    });
    if (clash) {
      throw new ConflictException(
        clash.username === username ? 'Username already exists.' : 'E-mail already exists.',
      );
    }

    const passwordHash = await this.passwords.hash(input.password);

    const created = await this.prisma.user.create({
      data: {
        username,
        email: emailCheck.email,
        fullName: input.fullName.trim(),
        passwordHash,
        role: input.role,
        status: 'ACTIVE',
        // Bootstrap passwords are transitional by definition.
        mustChangePassword: true,
        createdById: actor?.id ?? null,
      },
    });

    await this.passwords.rememberPassword(created.id, passwordHash);

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'User',
      entityId: created.id,
      actorId: actor?.id ?? null,
      actorIp: actor?.ip ?? null,
      actorUserAgent: actor?.userAgent ?? null,
      after: { username: created.username, email: created.email, role: created.role },
    });

    return UsersService.toPublicUser(created);
  }
}
