import { ObservableType, Tlp } from './enums';
import { ipv4InCidr, normalizeIp, normalizeIpv4, normalizeIpv6 } from './observables';

/**
 * Third-party lookups for indicators: VirusTotal, X-Force and the like.
 *
 * Deliberately links, not API calls. The lookup runs in the analyst's own
 * browser, so the server needs no internet access and holds no third-party
 * keys, and nothing is sent anywhere unless a person chooses to. An
 * administrator decides which services are offered and how their addresses
 * are built.
 */
export interface LookupProvider {
  /** Stable key; lowercase letters, digits and dashes. */
  id: string;
  name: string;
  enabled: boolean;
  /**
   * An in-house tool — a CMDB, IPAM or SIEM search — rather than an outside
   * service. Nothing leaves the network, so it is offered for internal
   * indicators and for every type, and PAP:RED and TLP:RED do not withhold
   * it. Absent on lists saved before the flag existed, which means outside.
   */
  internal?: boolean;
  /**
   * Address per indicator type. `{value}` is replaced by the indicator,
   * URL-encoded. A type with no template is simply not offered.
   */
  templates: Partial<Record<ObservableType, string>>;
}

export interface LookupSettings {
  providers: LookupProvider[];
  updatedAt: string | null;
  updatedById: string | null;
}

export const LOOKUP_SETTING_KEY = 'lookup.providers';
export const MAX_LOOKUP_PROVIDERS = 20;
export const LOOKUP_PLACEHOLDER = '{value}';

const HASHES = [ObservableType.HASH_MD5, ObservableType.HASH_SHA1, ObservableType.HASH_SHA256];
const forHashes = (template: string) =>
  Object.fromEntries(HASHES.map((type) => [type, template])) as Partial<
    Record<ObservableType, string>
  >;

/**
 * The types an outside service can say anything about. A hostname is a
 * machine's name inside the network, and a username, file name, registry key,
 * mutex or user agent means nothing to a reputation service on its own —
 * asking would only tell the service about this network.
 */
export const OUTSIDE_LOOKUP_TYPES: readonly ObservableType[] = [
  ObservableType.IP,
  ObservableType.DOMAIN,
  ObservableType.URL,
  ObservableType.EMAIL,
  ...HASHES,
];

/** What a fresh installation offers; an administrator can change all of it. */
export const DEFAULT_LOOKUP_PROVIDERS: LookupProvider[] = [
  {
    id: 'virustotal',
    name: 'VirusTotal',
    enabled: true,
    templates: {
      [ObservableType.IP]: 'https://www.virustotal.com/gui/ip-address/{value}',
      [ObservableType.DOMAIN]: 'https://www.virustotal.com/gui/domain/{value}',
      [ObservableType.URL]: 'https://www.virustotal.com/gui/search/{value}',
      ...forHashes('https://www.virustotal.com/gui/file/{value}'),
    },
  },
  {
    id: 'xforce',
    name: 'IBM X-Force Exchange',
    enabled: true,
    templates: {
      [ObservableType.IP]: 'https://exchange.xforce.ibmcloud.com/ip/{value}',
      [ObservableType.DOMAIN]: 'https://exchange.xforce.ibmcloud.com/url/{value}',
      [ObservableType.URL]: 'https://exchange.xforce.ibmcloud.com/url/{value}',
      ...forHashes('https://exchange.xforce.ibmcloud.com/malware/{value}'),
    },
  },
  {
    id: 'abuseipdb',
    name: 'AbuseIPDB',
    enabled: true,
    templates: { [ObservableType.IP]: 'https://www.abuseipdb.com/check/{value}' },
  },
  {
    id: 'otx',
    name: 'AlienVault OTX',
    enabled: true,
    templates: {
      [ObservableType.IP]: 'https://otx.alienvault.com/indicator/ip/{value}',
      [ObservableType.DOMAIN]: 'https://otx.alienvault.com/indicator/domain/{value}',
      [ObservableType.URL]: 'https://otx.alienvault.com/indicator/url/{value}',
      ...forHashes('https://otx.alienvault.com/indicator/file/{value}'),
    },
  },
  {
    id: 'shodan',
    name: 'Shodan',
    enabled: true,
    templates: { [ObservableType.IP]: 'https://www.shodan.io/host/{value}' },
  },
  {
    id: 'urlscan',
    name: 'urlscan.io',
    enabled: true,
    templates: {
      [ObservableType.IP]: 'https://urlscan.io/ip/{value}',
      [ObservableType.DOMAIN]: 'https://urlscan.io/domain/{value}',
    },
  },
];

export const DEFAULT_LOOKUP_SETTINGS: LookupSettings = {
  providers: DEFAULT_LOOKUP_PROVIDERS,
  updatedAt: null,
  updatedById: null,
};

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Problems with a provider list, as messages for an administrator; empty when fine. */
export function validateLookupProviders(providers: readonly LookupProvider[]): string[] {
  const problems: string[] = [];
  if (providers.length > MAX_LOOKUP_PROVIDERS) {
    problems.push(`At most ${MAX_LOOKUP_PROVIDERS} lookup services can be configured.`);
  }
  const seen = new Set<string>();
  for (const provider of providers) {
    const label = provider.name.trim() || provider.id;
    if (!PROVIDER_ID.test(provider.id))
      problems.push(`${label}: the key "${provider.id}" is not valid.`);
    if (seen.has(provider.id)) problems.push(`${label}: the key "${provider.id}" is used twice.`);
    seen.add(provider.id);
    if (!provider.name.trim() || provider.name.length > 40) {
      problems.push(`${label}: the name must be 1–40 characters.`);
    }
    for (const [type, template] of Object.entries(provider.templates)) {
      if (!template) continue;
      if (!(Object.values(ObservableType) as string[]).includes(type)) {
        problems.push(`${label}: "${type}" is not an indicator type.`);
        continue;
      }
      if (!provider.internal && !OUTSIDE_LOOKUP_TYPES.includes(type as ObservableType)) {
        problems.push(
          `${label} (${type}): outside services know nothing about this type; only an in-house tool can take it.`,
        );
      }
      // An intranet tool may well have no certificate; an outside service must.
      if (provider.internal ? !/^https?:\/\//.test(template) : !template.startsWith('https://')) {
        problems.push(
          `${label} (${type}): the address must start with ${provider.internal ? 'http:// or https://' : 'https://'}.`,
        );
      }
      if (!template.includes(LOOKUP_PLACEHOLDER)) {
        problems.push(`${label} (${type}): the address must contain ${LOOKUP_PLACEHOLDER}.`);
      }
      if (template.length > 500) problems.push(`${label} (${type}): the address is too long.`);
    }
  }
  return problems;
}

/** The address to open for one indicator, or null when the provider does not cover its type. */
export function lookupUrl(
  provider: LookupProvider,
  type: ObservableType,
  value: string,
): string | null {
  const template = provider.templates[type];
  if (!template) return null;
  return template.split(LOOKUP_PLACEHOLDER).join(encodeURIComponent(value));
}

/**
 * Whether an indicator may be looked up with third parties at all, and why not.
 *
 * PAP:RED allows no online checks; a TLP:RED indicator may not be disclosed
 * outside its recipients, and a lookup discloses it to the service. Everything
 * else may be checked — PAP:AMBER names third-party lookups as its example.
 */
export function lookupBlockedReason(context: {
  pap?: Tlp | null;
  tlp?: Tlp | null;
}): string | null {
  if (context.pap === Tlp.RED) {
    return 'PAP:RED — this case’s indicators may not be checked with outside services.';
  }
  if (context.tlp === Tlp.RED) {
    return 'TLP:RED — this indicator may not be disclosed to outside services.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal indicators
// ---------------------------------------------------------------------------

const RESERVED_IPV4: ReadonlyArray<readonly [cidr: string, kind: string]> = [
  ['10.0.0.0/8', 'a private address'],
  ['172.16.0.0/12', 'a private address'],
  ['192.168.0.0/16', 'a private address'],
  ['127.0.0.0/8', 'a loopback address'],
  ['169.254.0.0/16', 'a link-local address'],
  ['100.64.0.0/10', 'a carrier-grade NAT address'],
  ['0.0.0.0/8', 'a reserved address'],
  ['192.0.0.0/24', 'a reserved address'],
  ['192.0.2.0/24', 'a documentation address'],
  ['198.51.100.0/24', 'a documentation address'],
  ['203.0.113.0/24', 'a documentation address'],
  ['198.18.0.0/15', 'a benchmarking address'],
  ['224.0.0.0/4', 'a multicast address'],
  ['240.0.0.0/4', 'a reserved address'],
];

/** Names that never resolve on the internet: in-house conventions and RFC 2606/6761 reservations. */
const INTERNAL_SUFFIXES = [
  'local',
  'localdomain',
  'localhost',
  'lan',
  'home',
  'home.arpa',
  'internal',
  'intranet',
  'corp',
];
const RESERVED_NAMES = ['test', 'example', 'invalid', 'example.com', 'example.net', 'example.org'];

const under = (name: string, zone: string) => name === zone || name.endsWith(`.${zone}`);

function reservedIpv4(ip: string): string | null {
  const match = RESERVED_IPV4.find(([cidr]) => ipv4InCidr(ip, cidr));
  return match ? `${match[1]} (${match[0]})` : null;
}

function reservedIpv6(ip: string): string | null {
  // Expanded to eight 16-bit words; the normaliser has already compressed it.
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') && tail ? tail.split(':') : [];
  const words = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right].map(
    (word) => parseInt(word, 16),
  );
  const [a = 0, b = 0] = words;
  const zeroUntil = (end: number) => words.slice(0, end).every((word) => word === 0);

  if (zeroUntil(5) && words[5] === 0xffff) {
    const [high = 0, low = 0] = words.slice(6);
    return reservedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (zeroUntil(8)) return 'the unspecified address (::)';
  if (zeroUntil(7) && words[7] === 1) return 'the loopback address (::1)';
  if ((a & 0xfe00) === 0xfc00) return 'a unique local address (fc00::/7)';
  if ((a & 0xffc0) === 0xfe80) return 'a link-local address (fe80::/10)';
  if ((a & 0xff00) === 0xff00) return 'a multicast address (ff00::/8)';
  if (a === 0x2001 && b === 0x0db8) return 'a documentation address (2001:db8::/32)';
  return null;
}

function reservedIp(value: string): string | null {
  const v4 = normalizeIpv4(value);
  if (v4) return reservedIpv4(v4);
  const v6 = normalizeIpv6(value);
  return v6 ? reservedIpv6(v6) : null;
}

function internalName(value: string, organisationDomains: readonly string[]): string | null {
  const name = value.trim().toLowerCase().replace(/\.$/, '');
  if (!name) return null;
  if (!name.includes('.')) return 'a name without a domain';
  const own = organisationDomains.find((domain) => under(name, domain));
  if (own) return `in the organisation’s own domain (${own})`;
  const suffix = INTERNAL_SUFFIXES.find((zone) => under(name, zone));
  if (suffix) return `an internal name (.${suffix})`;
  const reserved = RESERVED_NAMES.find((zone) => under(name, zone));
  return reserved
    ? `a reserved name (${reserved.includes('.') ? reserved : `.${reserved}`})`
    : null;
}

function urlHost(value: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);
    return url.hostname.replace(/^\[|\]$/g, '') || null;
  } catch {
    return null;
  }
}

/**
 * Why an indicator belongs to the inside of a network — a private or reserved
 * address, an internal name, the organisation's own domain — or null when it
 * does not. Outside services know nothing about such indicators, and asking
 * them would only describe this network to a third party.
 */
export function internalIndicatorReason(
  type: ObservableType,
  value: string,
  organisationDomains: readonly string[] = [],
): string | null {
  switch (type) {
    case ObservableType.IP:
      return reservedIp(value);
    case ObservableType.DOMAIN:
    case ObservableType.HOSTNAME:
      return internalName(value, organisationDomains);
    case ObservableType.EMAIL: {
      const at = value.lastIndexOf('@');
      return at === -1 ? null : internalName(value.slice(at + 1), organisationDomains);
    }
    case ObservableType.URL: {
      const host = urlHost(value);
      if (!host) return null;
      return normalizeIp(host) ? reservedIp(host) : internalName(host, organisationDomains);
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// What one indicator is offered
// ---------------------------------------------------------------------------

export interface LookupOption {
  id: string;
  name: string;
  url: string;
  internal: boolean;
}

export interface LookupPlan {
  /** The services to offer, in the administrator's order. */
  options: LookupOption[];
  /**
   * Why outside services that would cover this type are left out: the
   * indicator is internal, or `policy` — the case's PAP or the indicator's
   * TLP forbids it, which an analyst should be told rather than left guessing.
   */
  withheld: { reason: string; policy: boolean } | null;
}

/**
 * The lookups that make sense for one indicator. Outside services only see
 * types they can say something about, never internal indicators, and nothing
 * the case's PAP or the indicator's TLP keeps in; in-house tools are offered
 * whatever covers the type.
 */
export function planLookup(
  providers: readonly LookupProvider[],
  type: ObservableType,
  value: string,
  context: { blockedReason?: string | null; organisationDomains?: readonly string[] } = {},
): LookupPlan {
  const offer = (provider: LookupProvider): LookupOption[] => {
    const url = provider.enabled ? lookupUrl(provider, type, value) : null;
    return url
      ? [{ id: provider.id, name: provider.name, url, internal: provider.internal === true }]
      : [];
  };
  const all = providers.flatMap(offer);
  const inside = all.filter((option) => option.internal);
  const outsideCovers =
    OUTSIDE_LOOKUP_TYPES.includes(type) && all.some((option) => !option.internal);
  if (!outsideCovers) return { options: inside, withheld: null };

  const internal = internalIndicatorReason(type, value, context.organisationDomains);
  if (internal) {
    return {
      options: inside,
      withheld: { reason: `Not sent outside: ${internal}.`, policy: false },
    };
  }
  if (context.blockedReason) {
    return { options: inside, withheld: { reason: context.blockedReason, policy: true } };
  }
  return { options: all, withheld: null };
}
