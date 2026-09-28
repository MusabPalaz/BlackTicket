import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as client from 'openid-client';
import {
  AuditAction,
  AuthMode,
  isSsoEnabled,
  type AuthPolicy,
  type Role,
} from '@black-ticket/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SettingsService } from '../../settings/settings.service';
import { UsersService } from '../../users/users.service';
import { TokenService } from '../token.service';
import { OidcService, requireOidc } from './oidc.service';
import { SsoProvisioningService, type FederatedIdentity } from './sso-provisioning.service';

/** A sign-in has to be finished promptly; the row is a bearer credential. */
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
/** The browser exchanges the handoff immediately on landing. */
const HANDOFF_TTL_MS = 60 * 1000;

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The federated sign-in flow.
 *
 * The browser never carries a token in a URL. The provider redirects back to
 * the API, the API mints a single-use handoff code, and the front end trades
 * that code for the ordinary access/refresh pair the rest of the application
 * already understands. Nothing downstream of `TokenService` learns that SSO
 * exists — which is what keeps guards, refresh and logout untouched.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly oidc: OidcService,
    private readonly provisioning: SsoProvisioningService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /** What the sign-in screen needs to decide whether to offer the button. */
  async publicStatus(): Promise<{ enabled: boolean; buttonLabel: string; localSignInAllowed: boolean }> {
    const policy = await this.settings.getAuthPolicy();
    return {
      enabled: isSsoEnabled(policy),
      buttonLabel: 'Sign in with your organisation account',
      // Under SSO the local form is still reachable, but only the break-glass
      // account can get through it. The screen says so rather than hiding it.
      localSignInAllowed: policy.mode !== AuthMode.SSO,
    };
  }

  private async policyOrThrow(): Promise<AuthPolicy> {
    const policy = await this.settings.getAuthPolicy();
    if (!isSsoEnabled(policy)) {
      throw new ForbiddenException('Single sign-on is not enabled.');
    }
    return policy;
  }

  async start(returnTo: string | undefined, context: RequestContext): Promise<string> {
    const policy = await this.policyOrThrow();
    const oidc = requireOidc(policy);
    const configuration = await this.oidc.configurationFor(oidc);

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    await this.prisma.ssoLoginAttempt.create({
      data: {
        stateHash: sha256(state),
        codeVerifier,
        nonce,
        returnTo: safeReturnTo(returnTo),
        ip: context.ip,
        userAgent: context.userAgent,
        expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
      },
    });

    return client
      .buildAuthorizationUrl(configuration, {
        redirect_uri: oidc.redirectUri,
        scope: oidc.scopes.join(' '),
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      .href;
  }

  /**
   * Completes the provider leg and returns where to send the browser.
   *
   * Errors come back as a destination too: the caller is a redirect endpoint,
   * and a raw 500 in a browser tab is a dead end for someone who only wanted
   * to sign in.
   */
  async callback(rawUrl: string, context: RequestContext): Promise<string> {
    const policy = await this.policyOrThrow();
    const oidc = requireOidc(policy);

    /*
     * Resolved against the configured redirect URI, never against the Host
     * header: this URL is what the authorization-code grant validates, and a
     * value the caller controls must not take part in that.
     */
    const currentUrl = new URL(rawUrl, oidc.redirectUri);

    const state = currentUrl.searchParams.get('state');
    if (!state) throw new BadRequestException('Missing state.');

    const attempt = await this.prisma.ssoLoginAttempt.findUnique({
      where: { stateHash: sha256(state) },
    });
    if (!attempt || attempt.consumedAt || attempt.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('This sign-in attempt is no longer valid. Start again.');
    }

    const configuration = await this.oidc.configurationFor(oidc);

    const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: attempt.codeVerifier,
      expectedState: state,
      expectedNonce: attempt.nonce,
    });

    const identity = await this.identityFrom(configuration, tokens, oidc);
    const user = await this.provisioning.resolve(identity, policy, context);

    const handoff = randomBytes(32).toString('base64url');
    await this.prisma.ssoLoginAttempt.update({
      where: { id: attempt.id },
      data: {
        userId: user.id,
        handoffHash: sha256(handoff),
        // The verifier has done its job; it does not need to outlive the leg.
        codeVerifier: '',
        expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
      },
    });

    const target = new URL('/auth/sso/callback', this.oidc.webBaseUrl());
    target.searchParams.set('code', handoff);
    if (attempt.returnTo) target.searchParams.set('returnTo', attempt.returnTo);
    return target.href;
  }

  /** Trades the single-use handoff for the application's own token pair. */
  async exchange(code: string, context: RequestContext) {
    const attempt = await this.prisma.ssoLoginAttempt.findUnique({
      where: { handoffHash: sha256(code) },
    });
    if (
      !attempt ||
      !attempt.userId ||
      attempt.consumedAt ||
      attempt.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('This sign-in code is no longer valid. Start again.');
    }

    /*
     * Consumed with a conditional update rather than a read-then-write: two
     * tabs replaying the same code must not both come away with a session.
     */
    const claimed = await this.prisma.ssoLoginAttempt.updateMany({
      where: { id: attempt.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('This sign-in code has already been used.');
    }

    const user = await this.prisma.user.update({
      where: { id: attempt.userId },
      data: { lastLoginAt: new Date(), lastLoginIp: context.ip },
    });

    const pair = await this.tokens.issuePair(
      {
        id: user.id,
        username: user.username,
        role: user.role as Role,
        mustChangePassword: user.mustChangePassword,
      },
      { ip: context.ip, userAgent: context.userAgent },
    );

    await this.audit.record({
      action: AuditAction.SSO_LOGIN,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorIp: context.ip,
      actorUserAgent: context.userAgent,
      metadata: { issuer: user.externalIssuer },
    });

    return { ...pair, user: UsersService.toPublicUser(user), returnTo: attempt.returnTo };
  }

  /**
   * Builds the identity from the id token, falling back to userinfo.
   *
   * Entra omits `groups` from the id token once a user is in more than about
   * 200 of them, and can be configured to keep the token small regardless — so
   * the claim missing is a normal case, not an error.
   */
  private async identityFrom(
    configuration: client.Configuration,
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    oidc: { usernameClaim: string; groupsClaim: string },
  ): Promise<FederatedIdentity> {
    const claims = tokens.claims();
    if (!claims) throw new UnauthorizedException('The identity provider returned no id token.');

    let merged: Record<string, unknown> = { ...claims };
    if (merged[oidc.groupsClaim] === undefined || merged.email === undefined) {
      try {
        const info = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);
        merged = { ...info, ...merged };
      } catch (error) {
        this.logger.warn(
          `userinfo lookup failed; continuing with id token claims only: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const username = stringClaim(merged, oidc.usernameClaim) ?? stringClaim(merged, 'preferred_username');
    const email = stringClaim(merged, 'email') ?? username;
    if (!email) {
      throw new UnauthorizedException(
        'The identity provider did not supply an e-mail address for this account.',
      );
    }

    return {
      issuer: String(claims.iss),
      subject: String(claims.sub),
      username: username ?? email,
      email,
      fullName: stringClaim(merged, 'name') ?? '',
      groups: stringArrayClaim(merged, oidc.groupsClaim),
    };
  }

  /** Sweeps attempts that were started and never finished. */
  async prune(): Promise<number> {
    const { count } = await this.prisma.ssoLoginAttempt.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - ATTEMPT_TTL_MS) } },
    });
    return count;
  }
}

function stringClaim(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArrayClaim(claims: Record<string, unknown>, key: string): string[] {
  const value = claims[key];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return typeof value === 'string' ? [value] : [];
}

/**
 * Only in-application paths survive.
 *
 * `returnTo` arrives from whoever built the sign-in link, so an absolute URL
 * here would turn the sign-in endpoint into an open redirect.
 */
function safeReturnTo(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value.slice(0, 512);
}
