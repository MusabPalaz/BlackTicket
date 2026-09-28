import { describe, expect, it } from 'vitest';
import { Role } from './enums';
import {
  AuthMode,
  DEFAULT_AUTH_POLICY,
  IdentityProvider,
  isSsoEnabled,
  mayUseLocalPassword,
  resolveRoleFromGroups,
  type AuthPolicy,
} from './auth-policy';

const local = { isRecoveryAccount: false, identityProvider: IdentityProvider.LOCAL };
const federated = { isRecoveryAccount: false, identityProvider: IdentityProvider.OIDC };
const breakGlass = { isRecoveryAccount: true, identityProvider: IdentityProvider.LOCAL };

function policy(overrides: Partial<AuthPolicy> = {}): AuthPolicy {
  return {
    ...DEFAULT_AUTH_POLICY,
    mode: AuthMode.SSO,
    oidc: {
      issuer: 'https://login.microsoftonline.com/tenant/v2.0',
      clientId: 'client',
      clientSecret: 'cipher',
      redirectUri: 'https://soc.example.com/api/v1/auth/sso/callback',
      scopes: ['openid', 'profile', 'email'],
      usernameClaim: 'preferred_username',
      groupsClaim: 'groups',
    },
    ...overrides,
  };
}

/**
 * SSO ships as a feature that one customer switches on and another never
 * touches, so the default has to be provably inert: these tests exist to make
 * a regression in that default a failing build rather than a support call.
 */
describe('auth policy defaults', () => {
  it('ships switched off', () => {
    expect(DEFAULT_AUTH_POLICY.mode).toBe(AuthMode.LOCAL);
    expect(DEFAULT_AUTH_POLICY.oidc).toBeNull();
    expect(isSsoEnabled(DEFAULT_AUTH_POLICY)).toBe(false);
  });

  it('refuses an unmapped user by default rather than guessing a role', () => {
    expect(DEFAULT_AUTH_POLICY.defaultRole).toBeNull();
    expect(resolveRoleFromGroups(DEFAULT_AUTH_POLICY, ['any-group'])).toBeNull();
  });

  it('is not enabled by the mode alone while it is unconfigured', () => {
    expect(isSsoEnabled(policy({ oidc: null }))).toBe(false);
  });
});

describe('local password eligibility', () => {
  it('lets every account sign in while SSO is off', () => {
    expect(mayUseLocalPassword(DEFAULT_AUTH_POLICY, local)).toBe(true);
    expect(mayUseLocalPassword(DEFAULT_AUTH_POLICY, breakGlass)).toBe(true);
  });

  /*
   * A tenant that trialled SSO and switched it off again must not find the
   * accounts it linked locked out. With SSO off the password hash is the gate,
   * and a provisioned account has none.
   */
  it('does not strand a linked account when SSO is switched back off', () => {
    expect(mayUseLocalPassword(DEFAULT_AUTH_POLICY, federated)).toBe(true);
  });

  it('narrows to the break-glass account once SSO is on', () => {
    expect(mayUseLocalPassword(policy(), local)).toBe(false);
    expect(mayUseLocalPassword(policy(), federated)).toBe(false);
    expect(mayUseLocalPassword(policy(), breakGlass)).toBe(true);
  });

  /*
   * The recovery account is the whole reason local passwords survive SSO: if
   * the provider is unreachable and nothing local can authenticate, there is
   * no way back into the system.
   */
  it('keeps the break-glass account usable even when SSO is misconfigured', () => {
    expect(mayUseLocalPassword(policy({ oidc: null }), breakGlass)).toBe(true);
  });
});

describe('role mapping', () => {
  const mapped = policy({
    roleMap: [
      { groupId: 'g-leads', groupName: 'SOC Leads', role: Role.SOC_LEAD },
      { groupId: 'g-analysts', groupName: 'SOC Analysts', role: Role.ANALYST },
    ],
  });

  it('takes the first matching group', () => {
    expect(resolveRoleFromGroups(mapped, ['g-analysts', 'g-leads'])).toBe(Role.SOC_LEAD);
  });

  it('falls back to the default role when nothing matches', () => {
    expect(resolveRoleFromGroups(mapped, ['g-other'])).toBeNull();
    expect(resolveRoleFromGroups({ ...mapped, defaultRole: Role.READ_ONLY }, ['g-other'])).toBe(
      Role.READ_ONLY,
    );
  });

  it('treats no group membership the same as no match', () => {
    expect(resolveRoleFromGroups(mapped, [])).toBeNull();
  });
});
