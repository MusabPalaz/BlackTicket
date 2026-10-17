import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as client from 'openid-client';
import { AuthMode, DEFAULT_AUTH_POLICY, type AuthPolicy } from '@black-ticket/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { SettingsService } from '../../settings/settings.service';
import type { UsersService } from '../../users/users.service';
import type { TokenService } from '../token.service';
import type { OidcService } from './oidc.service';
import type { SsoProvisioningService } from './sso-provisioning.service';
import { SsoService } from './sso.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const context = { ip: '203.0.113.7', userAgent: 'vitest' };

const policy: AuthPolicy = {
  ...DEFAULT_AUTH_POLICY,
  mode: AuthMode.SSO,
  oidc: {
    issuer: 'https://idp.corp.example',
    clientId: 'black-ticket',
    clientSecret: 'sealed',
    redirectUri: 'https://soc.corp.example/api/v1/auth/sso/callback',
    scopes: ['openid', 'profile', 'email'],
    usernameClaim: 'preferred_username',
    groupsClaim: 'groups',
  },
};

/** Stands in for the provider; reaching it means the browser check passed. */
const PAST_THE_BROWSER_CHECK = new Error('reached the identity provider');

function harness(attempt: Record<string, unknown> | null = null) {
  const prisma = {
    ssoLoginAttempt: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => attempt),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: {
      update: vi.fn(async () => ({
        id: 'user-1',
        username: 'someone',
        email: 'someone@corp.example',
        fullName: 'Some One',
        role: 'ANALYST',
        status: 'ACTIVE',
        mustChangePassword: false,
        totpEnabled: false,
        lastLoginAt: null,
        tags: [],
        isRecoveryAccount: false,
        externalIssuer: 'https://idp.corp.example',
      })),
    },
  };
  const settings = { getAuthPolicy: vi.fn(async () => policy) };
  const oidc = {
    configurationFor: vi.fn(async () => {
      throw PAST_THE_BROWSER_CHECK;
    }),
  };
  const tokens = {
    issuePair: vi.fn(async () => ({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })),
  };
  const audit = { record: vi.fn(async () => undefined) };

  const service = new SsoService(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
    oidc as unknown as OidcService,
    {} as SsoProvisioningService,
    tokens as unknown as TokenService,
    {} as UsersService,
    audit as unknown as AuditService,
  );
  return { service, prisma, oidc, tokens };
}

const pendingAttempt = (bindingHash: string | null) => ({
  id: 'attempt-1',
  stateHash: sha256('state'),
  bindingHash,
  codeVerifier: 'verifier',
  nonce: 'nonce',
  returnTo: null,
  userId: null,
  consumedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
});

const handedOffAttempt = (bindingHash: string | null) => ({
  ...pendingAttempt(bindingHash),
  userId: 'user-1',
  handoffHash: sha256('handoff-code'),
  codeVerifier: '',
});

describe('federated sign-in: tied to the browser that started it', () => {
  it('stores only the hash of the binding it hands to the browser', async () => {
    const { service, prisma, oidc } = harness();
    oidc.configurationFor.mockResolvedValueOnce(
      new client.Configuration(
        {
          issuer: 'https://idp.corp.example',
          authorization_endpoint: 'https://idp.corp.example/authorize',
        },
        'black-ticket',
      ),
    );

    const { url, binding } = await service.start(undefined, context);

    expect(url).toMatch(/^https:\/\/idp\.corp\.example\/authorize\?/);
    expect(binding.length).toBeGreaterThanOrEqual(43);
    expect(prisma.ssoLoginAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bindingHash: sha256(binding) }),
      }),
    );
    expect(JSON.stringify(prisma.ssoLoginAttempt.create.mock.calls)).not.toContain(binding);
  });

  it.each([
    ['without the cookie', null],
    ['with another browser’s cookie', 'someone-elses-binding'],
  ])('does not redeem the provider’s code for a callback %s', async (_label, binding) => {
    const { service, oidc } = harness(pendingAttempt(sha256('the-starting-browser')));

    await expect(
      service.callback('/api/v1/auth/sso/callback?code=c&state=state', binding, context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(oidc.configurationFor).not.toHaveBeenCalled();
  });

  it('lets the browser that started the sign-in on to the provider', async () => {
    const { service } = harness(pendingAttempt(sha256('the-starting-browser')));

    await expect(
      service.callback(
        '/api/v1/auth/sso/callback?code=c&state=state',
        'the-starting-browser',
        context,
      ),
    ).rejects.toBe(PAST_THE_BROWSER_CHECK);
  });

  it.each([
    ['without the cookie', null],
    ['with another browser’s cookie', 'someone-elses-binding'],
  ])('issues no session for a handoff code presented %s', async (_label, binding) => {
    const { service, prisma, tokens } = harness(handedOffAttempt(sha256('the-starting-browser')));

    await expect(service.exchange('handoff-code', binding, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.ssoLoginAttempt.updateMany).not.toHaveBeenCalled();
    expect(tokens.issuePair).not.toHaveBeenCalled();
  });

  it('refuses an attempt started before the binding existed', async () => {
    const { service, tokens } = harness(handedOffAttempt(null));

    await expect(service.exchange('handoff-code', 'anything', context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.issuePair).not.toHaveBeenCalled();
  });

  it('issues the session to the browser that started the sign-in', async () => {
    const { service, tokens } = harness(handedOffAttempt(sha256('the-starting-browser')));

    const result = await service.exchange('handoff-code', 'the-starting-browser', context);

    expect(tokens.issuePair).toHaveBeenCalledOnce();
    expect(result.accessToken).toBe('a');
  });
});
