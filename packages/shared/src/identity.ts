/**
 * Identity rules shared by the API and the admin console.
 *
 * The e-mail domain policy is configured once by an administrator and then
 * locked. From that point every account-creating path — the admin form, the CSV
 * import, the seed script — must produce addresses inside that domain, so the
 * rule lives here rather than being re-implemented per call site.
 */

export interface IdentityDomainPolicy {
  /** e.g. "blackticket.local". `null` means "not configured yet". */
  domain: string | null;
  /**
   * Once locked, the domain can no longer be changed through the normal admin
   * form; unlocking is a separate, re-authenticated, audited action.
   */
  locked: boolean;
  updatedAt: string | null;
  updatedById: string | null;
}

export const DEFAULT_IDENTITY_DOMAIN_POLICY: IdentityDomainPolicy = {
  domain: null,
  locked: false,
  updatedAt: null,
  updatedById: null,
};

export const IDENTITY_DOMAIN_SETTING_KEY = 'identity.emailDomain';

/** Deliberately conservative: labels, dots, at least one dot, max 253 chars. */
const DOMAIN_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Local-part rules kept simple on purpose; exotic addresses are rejected. */
const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}$/;

/** Letters, digits, dot, dash, underscore. No spaces, no '@'. */
const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidDomain(value: string): boolean {
  return DOMAIN_PATTERN.test(normalizeDomain(value));
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(value));
}

export function emailDomainOf(email: string): string | null {
  const at = normalizeEmail(email).lastIndexOf('@');
  return at === -1 ? null : normalizeEmail(email).slice(at + 1);
}

export type EmailPolicyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'INVALID_EMAIL' | 'DOMAIN_MISMATCH'; expectedDomain?: string };

/**
 * Validates an address against the configured policy.
 *
 * While no domain is configured any valid address is accepted — otherwise the
 * very first administrator could never be created.
 */
export function validateEmailAgainstPolicy(
  email: string,
  policy: IdentityDomainPolicy,
): EmailPolicyResult {
  const normalized = normalizeEmail(email);

  if (!isValidEmail(normalized)) {
    return { ok: false, reason: 'INVALID_EMAIL' };
  }

  if (!policy.domain) {
    return { ok: true, email: normalized };
  }

  const expected = normalizeDomain(policy.domain);
  if (emailDomainOf(normalized) !== expected) {
    return { ok: false, reason: 'DOMAIN_MISMATCH', expectedDomain: expected };
  }

  return { ok: true, email: normalized };
}

/**
 * Builds the address for a username when the CSV import supplies only the
 * username column. Requires a configured domain.
 */
export function buildEmailFromUsername(
  username: string,
  policy: IdentityDomainPolicy,
): string | null {
  if (!policy.domain) return null;
  return `${normalizeUsername(username)}@${normalizeDomain(policy.domain)}`;
}
