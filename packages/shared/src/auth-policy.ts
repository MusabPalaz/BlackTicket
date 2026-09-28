import type { Role } from './enums';

/**
 * Single sign-on is a feature, not a mode the product is in.
 *
 * One customer federates 600 accounts against their corporate directory;
 * another runs the same build on local accounts and never sees any of it. So
 * the policy defaults to LOCAL, and every code path added for SSO is reached
 * only after this setting says so — with LOCAL selected the application must
 * behave exactly as it did before SSO existed.
 */
export const AuthMode = {
  /** Local accounts only. The original behaviour, and the default. */
  LOCAL: 'LOCAL',
  /** The identity provider is the way in; local passwords are break-glass only. */
  SSO: 'SSO',
} as const;
export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode];

/** Where an account came from. Mirrors the Prisma enum of the same name. */
export const IdentityProvider = {
  LOCAL: 'LOCAL',
  OIDC: 'OIDC',
} as const;
export type IdentityProvider = (typeof IdentityProvider)[keyof typeof IdentityProvider];

export interface OidcConfig {
  /** Discovery base, e.g. https://login.microsoftonline.com/<tenant>/v2.0 */
  issuer: string;
  clientId: string;
  /**
   * secret-box ciphertext, never the plaintext, and never returned to a
   * client — the admin screen only ever learns whether one is configured.
   */
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  /** Claim carrying the sign-in name. Entra puts it in `preferred_username`. */
  usernameClaim: string;
  /** Claim carrying group membership, used for role mapping. */
  groupsClaim: string;
}

/** One directory group granting one application role. */
export interface RoleMapping {
  groupId: string;
  /** Only for display: group ids are opaque and unreadable on their own. */
  groupName: string;
  role: Role;
}

export interface AuthPolicy {
  mode: AuthMode;
  oidc: OidcConfig | null;
  /** Evaluated in order; the first group the user belongs to wins. */
  roleMap: RoleMapping[];
  /**
   * Role for someone who matched no mapping. `null` refuses the sign-in, which
   * is the safer default: an unmapped user getting a role by accident is how
   * a directory group rename turns into unintended access.
   */
  defaultRole: Role | null;
  updatedAt: string | null;
  updatedById: string | null;
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = {
  mode: AuthMode.LOCAL,
  oidc: null,
  roleMap: [],
  defaultRole: null,
  updatedAt: null,
  updatedById: null,
};

export const AUTH_POLICY_SETTING_KEY = 'auth.policy';

/** Whether federated sign-in is both switched on and actually configured. */
export function isSsoEnabled(policy: AuthPolicy): boolean {
  return policy.mode === AuthMode.SSO && policy.oidc !== null;
}

/**
 * Whether this account may still sign in with a local password.
 *
 * Under SSO that is the break-glass account alone. It is the reason the
 * recovery account keeps a password and a second factor at all: if the
 * identity provider is unreachable and nothing local can authenticate, the
 * system has no way back in.
 *
 * With SSO switched off this says yes to everyone, deliberately. The real gate
 * there is whether the account has a password hash at all — a provisioned one
 * does not, and fails on that. Testing the provider instead would lock out any
 * account that had been linked to a directory during a trial of SSO, the
 * moment SSO was turned back off.
 */
export function mayUseLocalPassword(
  policy: AuthPolicy,
  account: { isRecoveryAccount: boolean; identityProvider: IdentityProvider },
): boolean {
  if (!isSsoEnabled(policy)) return true;
  return account.isRecoveryAccount;
}

/** The role a set of directory groups earns, or null when none of them do. */
export function resolveRoleFromGroups(policy: AuthPolicy, groups: readonly string[]): Role | null {
  const match = policy.roleMap.find((mapping) => groups.includes(mapping.groupId));
  return match ? match.role : policy.defaultRole;
}
