import { ObservableType } from './enums';

/**
 * Observable normalisation — the foundation the correlation engine stands on.
 *
 * Two analysts will write the same indicator differently: `HXXP://Evil[.]com/a`
 * and `http://evil.com/a`, `1.2.3.4` and `1.2.3.004`, `::0001` and `::1`. If
 * these do not collapse to one canonical string, the same indicator lands in
 * two rows and the correlation never fires — a silent failure that looks
 * exactly like "no related cases".
 *
 * Rules of the house:
 *   * the analyst's original text is always preserved separately;
 *   * normalisation never throws — it reports why a value was rejected;
 *   * anything ambiguous is rejected rather than guessed at.
 */

export interface NormalizedObservable {
  type: ObservableType;
  normalized: string;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedObservable }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Defanging
// ---------------------------------------------------------------------------

/**
 * Undoes the ways people make indicators safe to paste into a chat window.
 * Applied before any type-specific parsing.
 */
export function refang(input: string): string {
  return input
    .trim()
    .replace(/\bh(?:xx|tt)p(s?)\s*:\s*\/\//gi, 'http$1://')
    .replace(/\bh(?:xx|tt)ps?\[:\]\/\//gi, (match) => (/s\[/i.test(match) ? 'https://' : 'http://'))
    .replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}/g, '.')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\[\s*:\s*\]/g, ':')
    .replace(/\[\s*(?:@|at)\s*\]|\(\s*(?:@|at)\s*\)|\s+at\s+(?=[a-z0-9.-]+\.[a-z]{2,})/gi, '@')
    .replace(/\[\s*\/\s*\]/g, '/')
    .trim();
}

// ---------------------------------------------------------------------------
// IP addresses
// ---------------------------------------------------------------------------

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function normalizeIpv4(value: string): string | null {
  const match = IPV4_PATTERN.exec(value.trim());
  if (!match) return null;

  const octets = match.slice(1, 5);
  for (const octet of octets) {
    // "01" is rejected rather than read as 1: leading zeros are parsed as
    // octal by some resolvers, so the two spellings are not reliably the
    // same host and must not be silently merged.
    if (octet.length > 1 && octet.startsWith('0')) return null;
    const number = Number(octet);
    if (!Number.isInteger(number) || number < 0 || number > 255) return null;
  }
  return octets.join('.');
}

/**
 * Collapses an IPv6 address to the RFC 5952 canonical form: lower case, no
 * leading zeros, and `::` replacing the longest run of zero groups.
 */
export function normalizeIpv6(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!raw.includes(':')) return null;
  if (/[^0-9a-f:.]/.test(raw)) return null;
  if (raw.split('::').length > 2) return null;

  const [head = '', tail = ''] = raw.includes('::') ? raw.split('::') : [raw, ''];
  const headGroups = head ? head.split(':') : [];
  const tailGroups = raw.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups: string[] = [];

  // A trailing IPv4 form (::ffff:1.2.3.4) is expanded into two groups.
  const expandTrailingIpv4 = (list: string[]): string[] | null => {
    const last = list[list.length - 1];
    if (!last || !last.includes('.')) return list;
    const ipv4 = normalizeIpv4(last);
    if (!ipv4) return null;
    const [a, b, c, d] = ipv4.split('.').map(Number) as [number, number, number, number];
    return [
      ...list.slice(0, -1),
      ((a << 8) | b).toString(16),
      ((c << 8) | d).toString(16),
    ];
  };

  const head2 = expandTrailingIpv4(headGroups);
  const tail2 = expandTrailingIpv4(tailGroups);
  if (!head2 || !tail2) return null;

  const missing = 8 - (head2.length + tail2.length);
  if (raw.includes('::')) {
    if (missing < 1) return null;
    groups.push(...head2, ...Array<string>(missing).fill('0'), ...tail2);
  } else {
    groups.push(...head2);
  }

  if (groups.length !== 8) return null;

  const parsed = groups.map((group) => {
    if (group === '') return null;
    if (group.length > 4 || !/^[0-9a-f]+$/.test(group)) return null;
    return parseInt(group, 16).toString(16);
  });
  if (parsed.some((group) => group === null)) return null;
  const words = parsed as string[];

  // Longest run of zero groups (leftmost on a tie) becomes "::".
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  for (let index = 0; index <= words.length; index += 1) {
    if (index < words.length && words[index] === '0') {
      if (currentStart === -1) currentStart = index;
    } else if (currentStart !== -1) {
      const length = index - currentStart;
      if (length > bestLength) {
        bestStart = currentStart;
        bestLength = length;
      }
      currentStart = -1;
    }
  }

  if (bestLength < 2) return words.join(':');

  const left = words.slice(0, bestStart).join(':');
  const right = words.slice(bestStart + bestLength).join(':');
  return `${left}::${right}`;
}

export function normalizeIp(value: string): string | null {
  return normalizeIpv4(value) ?? normalizeIpv6(value);
}

// ---------------------------------------------------------------------------
// Domains, hostnames and URLs
// ---------------------------------------------------------------------------

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)+$/;

/**
 * Lower-cases, strips a trailing dot and converts an internationalised name to
 * its punycode form, so `münchen.de` and `xn--mnchen-3ya.de` correlate.
 */
export function normalizeDomainName(value: string): string | null {
  const candidate = refang(value).toLowerCase().replace(/\.$/, '');
  if (!candidate) return null;

  // The URL parser would read "user@host" as credentials plus a host and hand
  // back just the host — silently turning a pasted e-mail address into a
  // domain. Anything carrying URL syntax is rejected instead of reinterpreted.
  if (/[@/?#\s:]/.test(candidate)) return null;

  let ascii: string;
  try {
    // The URL parser is the platform's punycode implementation, in both Node
    // and the browser — no dependency needed.
    ascii = new URL(`http://${candidate}`).hostname;
  } catch {
    return null;
  }

  if (normalizeIp(ascii)) return null; // an address is not a domain
  return DOMAIN_PATTERN.test(ascii) ? ascii : null;
}

export function normalizeUrl(value: string): string | null {
  const candidate = refang(value);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!/^https?:|^ftp:$/.test(url.protocol)) return null;
  if (!url.hostname) return null;

  // Default ports are dropped, the fragment is discarded (it never reaches the
  // server), and host and scheme are lower-cased. Path and query keep their
  // case: they are frequently case-sensitive.
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  url.hash = '';

  const normalized = url.toString();
  return normalized.endsWith('/') && url.pathname === '/' && !url.search
    ? normalized.slice(0, -1)
    : normalized;
}

// ---------------------------------------------------------------------------
// Hashes, e-mail, everything else
// ---------------------------------------------------------------------------

const HASH_LENGTHS: Record<number, ObservableType> = {
  32: ObservableType.HASH_MD5,
  40: ObservableType.HASH_SHA1,
  64: ObservableType.HASH_SHA256,
};

export function normalizeHash(value: string, expected?: ObservableType): string | null {
  const candidate = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!/^[0-9a-f]+$/.test(candidate)) return null;

  const detected = HASH_LENGTHS[candidate.length];
  if (!detected) return null;
  if (expected && expected !== detected) return null;
  return candidate;
}

// Exactly one "@": an unquoted address with several is invalid, and guessing
// which one separates the parts would be a guess about an indicator.
const EMAIL_PATTERN = /^[^\s@]{1,64}@[a-z0-9.-]{1,253}$/;

export function normalizeEmailAddress(value: string): string | null {
  const candidate = refang(value).toLowerCase();
  if (!EMAIL_PATTERN.test(candidate)) return null;

  const at = candidate.indexOf('@');
  const domain = normalizeDomainName(candidate.slice(at + 1));
  if (!domain) return null;

  // The local part is lower-cased too. RFC-wise it is case-sensitive, but no
  // mail system in practice treats it that way, and an analyst typing
  // "John.Doe@" must correlate with the log line saying "john.doe@".
  return `${candidate.slice(0, at)}@${domain}`;
}

const REGISTRY_HIVES: Record<string, string> = {
  hklm: 'hkey_local_machine',
  hkcu: 'hkey_current_user',
  hkcr: 'hkey_classes_root',
  hku: 'hkey_users',
  hkcc: 'hkey_current_config',
};

export function normalizeRegistryKey(value: string): string | null {
  const candidate = value.trim().toLowerCase().replace(/\//g, '\\').replace(/\\+/g, '\\');
  if (!candidate) return null;
  const [hive = '', ...rest] = candidate.split('\\');
  const expanded = REGISTRY_HIVES[hive] ?? hive;
  return [expanded, ...rest].join('\\');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function normalizeObservable(type: ObservableType, value: string): NormalizeResult {
  const raw = value.trim();
  if (!raw) return { ok: false, reason: 'Value is empty.' };
  if (raw.length > 2_048) return { ok: false, reason: 'Value is too long.' };

  const fail = (what: string): NormalizeResult => ({ ok: false, reason: `Not a valid ${what}.` });
  const done = (normalized: string, resolvedType: ObservableType = type): NormalizeResult => ({
    ok: true,
    value: { type: resolvedType, normalized },
  });

  switch (type) {
    case ObservableType.IP: {
      const ip = normalizeIp(refang(raw));
      return ip ? done(ip) : fail('IP address');
    }
    case ObservableType.DOMAIN: {
      const domain = normalizeDomainName(raw);
      return domain ? done(domain) : fail('domain');
    }
    case ObservableType.URL: {
      const url = normalizeUrl(raw);
      return url ? done(url) : fail('URL');
    }
    case ObservableType.HASH_MD5:
    case ObservableType.HASH_SHA1:
    case ObservableType.HASH_SHA256: {
      const hash = normalizeHash(raw, type);
      return hash ? done(hash) : fail(`${type.replace('HASH_', '')} hash`);
    }
    case ObservableType.EMAIL: {
      const email = normalizeEmailAddress(raw);
      return email ? done(email) : fail('e-mail address');
    }
    case ObservableType.HOSTNAME: {
      const hostname = refang(raw).toLowerCase().replace(/\.$/, '');
      return /^[a-z0-9_][a-z0-9_.-]{0,252}$/.test(hostname) ? done(hostname) : fail('hostname');
    }
    case ObservableType.REGISTRY_KEY: {
      const key = normalizeRegistryKey(raw);
      return key ? done(key) : fail('registry key');
    }
    case ObservableType.USERNAME:
    case ObservableType.FILENAME:
      // Windows treats both as case-insensitive, and cross-platform casing
      // differences would otherwise split one indicator into several.
      return done(raw.toLowerCase());
    case ObservableType.MUTEX:
    case ObservableType.USER_AGENT:
    case ObservableType.OTHER:
      // Case can be meaningful here, so only surrounding whitespace goes.
      return done(raw.replace(/\s+/g, ' '));
    default:
      return fail('observable');
  }
}

// ---------------------------------------------------------------------------
// Detection and bulk extraction
// ---------------------------------------------------------------------------

/** Best-effort type guess for a single pasted value. */
export function detectObservableType(value: string): ObservableType | null {
  const candidate = refang(value);
  if (!candidate) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && normalizeUrl(candidate)) {
    return ObservableType.URL;
  }
  if (normalizeIp(candidate)) return ObservableType.IP;
  if (/^[0-9a-f]+$/i.test(candidate) && HASH_LENGTHS[candidate.length]) {
    return HASH_LENGTHS[candidate.length] ?? null;
  }
  if (candidate.includes('@') && normalizeEmailAddress(candidate)) return ObservableType.EMAIL;
  if (/^hk(ey_|lm|cu|cr|u|cc)/i.test(candidate)) return ObservableType.REGISTRY_KEY;
  if (normalizeDomainName(candidate)) return ObservableType.DOMAIN;
  return null;
}

export interface ExtractedObservable {
  type: ObservableType;
  /** The text as it appeared, refanged but otherwise untouched. */
  value: string;
  normalized: string;
}

const URL_SCAN = /\b(?:https?|ftp):\/\/[^\s<>"'()]+/gi;
const EMAIL_SCAN = /\b[^\s@<>"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}\b/gi;
const HASH_SCAN = /\b[0-9a-f]{32}(?:[0-9a-f]{8})?(?:[0-9a-f]{24})?\b/gi;
const IPV4_SCAN = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6_SCAN = /\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%[0-9a-z]+)?\b/gi;
const DOMAIN_SCAN = /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,63})+\b/gi;

/**
 * Pulls indicators out of a block of pasted text — a mail header, a SIEM row,
 * a chat message. Deliberately ordered: URLs and e-mails are consumed first so
 * their hosts are not also reported as bare domains.
 *
 * Deduplicated by (type, normalized value).
 */
export function extractObservables(text: string): ExtractedObservable[] {
  let working = refang(text);
  const found = new Map<string, ExtractedObservable>();

  const take = (pattern: RegExp, resolve: (raw: string) => ExtractedObservable | null) => {
    const matches = working.match(pattern) ?? [];
    for (const raw of matches) {
      const entry = resolve(raw);
      if (!entry) continue;
      const key = `${entry.type}|${entry.normalized}`;
      if (!found.has(key)) found.set(key, entry);
    }
    // Remove what was consumed so later, broader patterns cannot re-match it.
    working = working.replace(pattern, ' ');
  };

  take(URL_SCAN, (raw) => {
    const normalized = normalizeUrl(raw);
    return normalized ? { type: ObservableType.URL, value: raw, normalized } : null;
  });

  take(EMAIL_SCAN, (raw) => {
    const normalized = normalizeEmailAddress(raw);
    return normalized ? { type: ObservableType.EMAIL, value: raw, normalized } : null;
  });

  take(HASH_SCAN, (raw) => {
    const normalized = normalizeHash(raw);
    const type = normalized ? HASH_LENGTHS[normalized.length] : undefined;
    return normalized && type ? { type, value: raw, normalized } : null;
  });

  take(IPV4_SCAN, (raw) => {
    const normalized = normalizeIpv4(raw);
    return normalized ? { type: ObservableType.IP, value: raw, normalized } : null;
  });

  take(IPV6_SCAN, (raw) => {
    const normalized = normalizeIpv6(raw);
    return normalized ? { type: ObservableType.IP, value: raw, normalized } : null;
  });

  take(DOMAIN_SCAN, (raw) => {
    const normalized = normalizeDomainName(raw);
    return normalized ? { type: ObservableType.DOMAIN, value: raw, normalized } : null;
  });

  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Whitelist matching
// ---------------------------------------------------------------------------

/** Whether an IPv4 address falls inside a CIDR block such as 10.0.0.0/8. */
export function ipv4InCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/');
  if (!network || bitsRaw === undefined) return false;

  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const toInt = (value: string): number | null => {
    const normalized = normalizeIpv4(value);
    if (!normalized) return null;
    return normalized
      .split('.')
      .reduce((accumulator, octet) => (accumulator << 8) + Number(octet), 0) >>> 0;
  };

  const address = toInt(ip);
  const base = toInt(network);
  if (address === null || base === null) return false;

  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (base & mask);
}

/** Whether a string is a well-formed IPv4 CIDR block such as 10.0.0.0/8. */
export function isValidIpv4Cidr(value: string): boolean {
  const [network, bitsRaw, ...rest] = value.trim().split('/');
  if (!network || bitsRaw === undefined || rest.length > 0) return false;

  const bits = Number(bitsRaw);
  if (!/^\d{1,2}$/.test(bitsRaw) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  return normalizeIpv4(network) !== null;
}

export interface WhitelistRule {
  type: ObservableType;
  pattern: string;
  isCidr: boolean;
}

/**
 * Whether an indicator should be excluded from correlation.
 *
 * Supports exact matches, IPv4 CIDR blocks and `*.example.com` suffixes.
 */
export function isWhitelisted(
  observable: { type: ObservableType; normalized: string },
  rules: readonly WhitelistRule[],
): boolean {
  return rules.some((rule) => {
    if (rule.type !== observable.type) return false;

    if (rule.isCidr) {
      return ipv4InCidr(observable.normalized, rule.pattern);
    }

    const pattern = rule.pattern.trim().toLowerCase();
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      return (
        observable.normalized.endsWith(suffix) || observable.normalized === pattern.slice(2)
      );
    }

    return observable.normalized === pattern;
  });
}
