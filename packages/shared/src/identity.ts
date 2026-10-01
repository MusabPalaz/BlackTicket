/**
 * Identity rules shared by the API and the admin console.
 *
 * The e-mail domain policy is configured by an administrator (and usually
 * locked). From then on every account-creating path — the admin form, the CSV
 * import, SSO, SCIM, the seed script — must produce addresses inside the
 * organisation's domains, so the rule lives here rather than being
 * re-implemented per call site.
 */

export interface IdentityDomainPolicy {
  /**
   * The primary domain, e.g. "blackticket.local". `null` means "not configured
   * yet". Addresses built from a bare username use this one.
   */
  domain: string | null;
  /**
   * Further domains of the same organisation. One directory tenant commonly
   * serves several mail domains, and everyone in them is as much a member as
   * someone in the primary one, so each is accepted wherever the primary is.
   * Absent from policies saved before the list existed; read it through
   * organisationDomains().
   */
  additionalDomains?: string[];
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
  additionalDomains: [],
  locked: false,
  updatedAt: null,
  updatedById: null,
};

export const IDENTITY_DOMAIN_SETTING_KEY = 'identity.emailDomain';

/** Enough for any real organisation, small enough to keep the checks trivial. */
export const MAX_ADDITIONAL_DOMAINS = 50;

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

/** Every domain an account may use: the primary first, then the others. */
export function organisationDomains(policy: IdentityDomainPolicy): string[] {
  if (!policy.domain) return [];
  const all = [policy.domain, ...(policy.additionalDomains ?? [])].map(normalizeDomain);
  return [...new Set(all)];
}

/** "@a.com", "@a.com or @b.com", "@a.com, @b.com or @c.com" — for messages. */
export function formatDomainList(domains: readonly string[]): string {
  const tagged = domains.map((domain) => `@${domain}`);
  if (tagged.length <= 1) return tagged.join('');
  return `${tagged.slice(0, -1).join(', ')} or ${tagged[tagged.length - 1]}`;
}

export type EmailPolicyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'INVALID_EMAIL' | 'DOMAIN_MISMATCH'; expectedDomains?: string[] };

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

  const expected = organisationDomains(policy);
  if (expected.length === 0) {
    return { ok: true, email: normalized };
  }

  const domain = emailDomainOf(normalized);
  if (domain === null || !expected.includes(domain)) {
    return { ok: false, reason: 'DOMAIN_MISMATCH', expectedDomains: expected };
  }

  return { ok: true, email: normalized };
}

/**
 * Builds the address for a username when the CSV import supplies only the
 * username column. Requires a configured domain, and always uses the primary
 * one: with several to choose from, the others have to be spelled out.
 */
export function buildEmailFromUsername(
  username: string,
  policy: IdentityDomainPolicy,
): string | null {
  if (!policy.domain) return null;
  return `${normalizeUsername(username)}@${normalizeDomain(policy.domain)}`;
}
