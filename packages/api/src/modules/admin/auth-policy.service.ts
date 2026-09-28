import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuthMode,
  Role,
  type AuthPolicy,
  type OidcConfig,
  type RoleMapping,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { OidcService } from '../auth/sso/oidc.service';

interface Actor {
  id: string;
  ip: string | null;
  userAgent: string | null;
}

/** The policy as a screen may see it — never carrying the client secret back. */
export interface AuthPolicyView {
  mode: AuthMode;
  oidc: (Omit<OidcConfig, 'clientSecret'> & { clientSecretConfigured: boolean }) | null;
  roleMap: RoleMapping[];
  defaultRole: Role | null;
  updatedAt: string | null;
  updatedById: string | null;
  /** Whether a break-glass account exists; SSO cannot be switched on without one. */
  hasRecoveryAccount: boolean;
}

export interface UpdateAuthPolicyInput {
  mode: AuthMode;
  issuer?: string;
  clientId?: string;
  /** Absent means "keep the stored secret"; the screen never receives it back. */
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  usernameClaim?: string;
  groupsClaim?: string;
  roleMap?: RoleMapping[];
  defaultRole?: Role | null;
}

/**
 * Administration of the federated sign-in policy.
 *
 * The one rule this service will not bend: switching the product into SSO mode
 * requires a working break-glass account. Everything else here is a setting; a
 * mistake in that one is an organisation locked out of its own SOC platform
 * with nothing left to fix it from.
 */
@Injectable()
export class AuthPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly oidc: OidcService,
  ) {}

  private async hasRecoveryAccount(): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { isRecoveryAccount: true, status: 'ACTIVE', deletedAt: null },
    });
    return count > 0;
  }

  static toView(policy: AuthPolicy, hasRecoveryAccount: boolean): AuthPolicyView {
    return {
      mode: policy.mode,
      oidc: policy.oidc
        ? {
            issuer: policy.oidc.issuer,
            clientId: policy.oidc.clientId,
            redirectUri: policy.oidc.redirectUri,
            scopes: policy.oidc.scopes,
            usernameClaim: policy.oidc.usernameClaim,
            groupsClaim: policy.oidc.groupsClaim,
            clientSecretConfigured: policy.oidc.clientSecret.length > 0,
          }
        : null,
      roleMap: policy.roleMap,
      defaultRole: policy.defaultRole,
      updatedAt: policy.updatedAt,
      updatedById: policy.updatedById,
      hasRecoveryAccount,
    };
  }

  async view(): Promise<AuthPolicyView> {
    const policy = await this.settings.getAuthPolicy();
    return AuthPolicyService.toView(policy, await this.hasRecoveryAccount());
  }

  async update(input: UpdateAuthPolicyInput, actor: Actor): Promise<AuthPolicyView> {
    const current = await this.settings.getAuthPolicy();
    const oidc = this.mergeOidc(current.oidc, input);

    if (input.mode === AuthMode.SSO) {
      if (!oidc) {
        throw new BadRequestException(
          'Configure the identity provider before switching sign-in over to it.',
        );
      }
      if (!(await this.hasRecoveryAccount())) {
        /*
         * Without a break-glass account, a wrong issuer or an expired client
         * secret would leave nobody able to sign in and nobody able to undo it.
         */
        throw new ConflictException(
          'No active break-glass account exists. Create one before enabling single sign-on, or a provider outage would lock everyone out.',
        );
      }
    }

    const updated: AuthPolicy = {
      mode: input.mode,
      oidc,
      roleMap: input.roleMap ?? current.roleMap,
      defaultRole: input.defaultRole === undefined ? current.defaultRole : input.defaultRole,
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };

    await this.settings.setAuthPolicy(updated);
    // Issuer or credentials may have moved; the next sign-in re-reads discovery.
    this.oidc.invalidate();

    await this.audit.record({
      action: AuditAction.AUTH_POLICY_CHANGED,
      entityType: 'SystemSetting',
      entityId: 'auth.policy',
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      // Redacted on both sides: an audit trail is not a place to leak a secret.
      before: AuthPolicyService.toView(current, true),
      after: AuthPolicyService.toView(updated, true),
    });

    return AuthPolicyService.toView(updated, await this.hasRecoveryAccount());
  }

  /**
   * Folds the submitted fields onto what is stored.
   *
   * An omitted client secret means "keep the one you have" — the screen cannot
   * echo back a value it is never given, so requiring it on every save would
   * force the administrator to re-type it to change a claim name.
   */
  private mergeOidc(current: OidcConfig | null, input: UpdateAuthPolicyInput): OidcConfig | null {
    const issuer = input.issuer?.trim() || current?.issuer;
    const clientId = input.clientId?.trim() || current?.clientId;
    const redirectUri = input.redirectUri?.trim() || current?.redirectUri;

    if (!issuer && !clientId && !redirectUri && !input.clientSecret) return current;

    if (!issuer || !clientId || !redirectUri) {
      throw new BadRequestException('Issuer, client id and redirect URI are all required.');
    }
    assertHttpsUrl(issuer, 'Issuer');
    assertHttpsUrl(redirectUri, 'Redirect URI');

    const clientSecret = input.clientSecret
      ? this.oidc.encryptClientSecret(input.clientSecret)
      : current?.clientSecret;
    if (!clientSecret) {
      throw new BadRequestException('A client secret is required the first time.');
    }

    return {
      issuer,
      clientId,
      clientSecret,
      redirectUri,
      scopes: input.scopes?.length ? input.scopes : (current?.scopes ?? ['openid', 'profile', 'email']),
      usernameClaim: input.usernameClaim?.trim() || current?.usernameClaim || 'preferred_username',
      groupsClaim: input.groupsClaim?.trim() || current?.groupsClaim || 'groups',
    };
  }

  /** Reachability check for the screen, run against what is stored. */
  async test(): Promise<{ ok: boolean; detail: string }> {
    const policy = await this.settings.getAuthPolicy();
    if (!policy.oidc) return { ok: false, detail: 'No identity provider is configured yet.' };
    this.oidc.invalidate();
    return this.oidc.probe(policy.oidc);
  }
}

/**
 * Plain http is refused except on loopback, where a developer has no
 * certificate and no exposure. Anywhere else it would put an authorization
 * code on the wire in clear text.
 */
function assertHttpsUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(`${label} must be a valid URL.`);
  }

  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !loopback) {
    throw new BadRequestException(`${label} must use https.`);
  }
}
