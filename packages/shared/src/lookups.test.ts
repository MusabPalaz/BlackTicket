import { describe, expect, it } from 'vitest';
import { ObservableType, Tlp } from './enums';
import {
  DEFAULT_LOOKUP_PROVIDERS,
  internalIndicatorReason,
  lookupBlockedReason,
  lookupUrl,
  planLookup,
  validateLookupProviders,
  type LookupProvider,
} from './lookups';

const virusTotal = DEFAULT_LOOKUP_PROVIDERS.find((provider) => provider.id === 'virustotal')!;

describe('lookup addresses', () => {
  it('fills the indicator into the template', () => {
    expect(lookupUrl(virusTotal, ObservableType.IP, '185.220.101.4')).toBe(
      'https://www.virustotal.com/gui/ip-address/185.220.101.4',
    );
  });

  it('encodes the indicator so a URL cannot break out of the address', () => {
    expect(lookupUrl(virusTotal, ObservableType.URL, 'https://evil.example/a?b=c&d=e')).toBe(
      'https://www.virustotal.com/gui/search/https%3A%2F%2Fevil.example%2Fa%3Fb%3Dc%26d%3De',
    );
  });

  it('offers nothing for a type the service does not cover', () => {
    expect(lookupUrl(virusTotal, ObservableType.USERNAME, 'jdoe')).toBeNull();
  });
});

describe('lookup provider validation', () => {
  it('accepts the shipped defaults', () => {
    expect(validateLookupProviders(DEFAULT_LOOKUP_PROVIDERS)).toEqual([]);
  });

  it('refuses addresses that are not https or have no placeholder', () => {
    const provider: LookupProvider = {
      id: 'custom',
      name: 'Custom',
      enabled: true,
      templates: {
        [ObservableType.IP]: 'http://intel.example/{value}',
        [ObservableType.DOMAIN]: 'https://intel.example/domain',
      },
    };
    const problems = validateLookupProviders([provider]);
    expect(problems.some((p) => p.includes('https://'))).toBe(true);
    expect(problems.some((p) => p.includes('{value}'))).toBe(true);
  });

  it('keeps outside services to the types they can say something about', () => {
    const provider: LookupProvider = {
      id: 'custom',
      name: 'Custom',
      enabled: true,
      templates: { [ObservableType.HOSTNAME]: 'https://intel.example/host/{value}' },
    };
    expect(validateLookupProviders([provider]).some((p) => p.includes('in-house'))).toBe(true);
    expect(validateLookupProviders([{ ...provider, internal: true }])).toEqual([]);
  });

  it('lets an in-house tool use plain http', () => {
    const cmdb: LookupProvider = {
      id: 'cmdb',
      name: 'CMDB',
      enabled: true,
      internal: true,
      templates: { [ObservableType.IP]: 'http://cmdb.corp.local/search?q={value}' },
    };
    expect(validateLookupProviders([cmdb])).toEqual([]);
  });

  it('refuses a key used twice', () => {
    expect(validateLookupProviders([virusTotal, virusTotal]).some((p) => p.includes('twice'))).toBe(
      true,
    );
  });
});

describe('when a lookup is not allowed', () => {
  it('blocks PAP:RED cases and TLP:RED indicators', () => {
    expect(lookupBlockedReason({ pap: Tlp.RED })).toMatch(/PAP:RED/);
    expect(lookupBlockedReason({ pap: Tlp.AMBER, tlp: Tlp.RED })).toMatch(/TLP:RED/);
  });

  it('allows PAP:AMBER, whose own definition names third-party checks', () => {
    expect(lookupBlockedReason({ pap: Tlp.AMBER, tlp: Tlp.AMBER })).toBeNull();
    expect(lookupBlockedReason({})).toBeNull();
  });
});

describe('internal indicators', () => {
  it('recognises private and reserved IPv4 addresses', () => {
    expect(internalIndicatorReason(ObservableType.IP, '192.168.1.10')).toMatch(/private/);
    expect(internalIndicatorReason(ObservableType.IP, '10.20.30.40')).toMatch(/10\.0\.0\.0\/8/);
    expect(internalIndicatorReason(ObservableType.IP, '172.20.0.5')).toMatch(/private/);
    expect(internalIndicatorReason(ObservableType.IP, '127.0.0.1')).toMatch(/loopback/);
    expect(internalIndicatorReason(ObservableType.IP, '169.254.10.1')).toMatch(/link-local/);
    expect(internalIndicatorReason(ObservableType.IP, '100.64.3.2')).toMatch(/NAT/);
    expect(internalIndicatorReason(ObservableType.IP, '239.255.255.250')).toMatch(/multicast/);
  });

  it('leaves public IPv4 addresses alone, right up to the edge of a range', () => {
    expect(internalIndicatorReason(ObservableType.IP, '185.220.101.4')).toBeNull();
    expect(internalIndicatorReason(ObservableType.IP, '172.32.0.1')).toBeNull();
    expect(internalIndicatorReason(ObservableType.IP, '100.128.0.1')).toBeNull();
  });

  it('recognises internal IPv6 addresses, including mapped IPv4', () => {
    expect(internalIndicatorReason(ObservableType.IP, '::1')).toMatch(/loopback/);
    expect(internalIndicatorReason(ObservableType.IP, 'fe80::1ff:fe23:4567:890a')).toMatch(
      /link-local/,
    );
    expect(internalIndicatorReason(ObservableType.IP, 'fd12:3456:789a::1')).toMatch(/unique local/);
    expect(internalIndicatorReason(ObservableType.IP, '::ffff:192.168.1.1')).toMatch(/private/);
    expect(internalIndicatorReason(ObservableType.IP, '2606:4700:4700::1111')).toBeNull();
  });

  it('recognises internal names and the organisation’s own domains', () => {
    const own = ['contoso.com'];
    expect(internalIndicatorReason(ObservableType.DOMAIN, 'dc01.corp.local', own)).toMatch(
      /\.local/,
    );
    expect(internalIndicatorReason(ObservableType.DOMAIN, 'vpn.contoso.com', own)).toMatch(
      /contoso\.com/,
    );
    expect(internalIndicatorReason(ObservableType.DOMAIN, 'contoso.com', own)).not.toBeNull();
    expect(internalIndicatorReason(ObservableType.DOMAIN, 'notcontoso.com', own)).toBeNull();
    expect(internalIndicatorReason(ObservableType.DOMAIN, 'evil-login.net', own)).toBeNull();
  });

  it('looks at the host of a URL and the domain of an e-mail address', () => {
    const own = ['contoso.com'];
    expect(internalIndicatorReason(ObservableType.URL, 'http://10.0.0.5/admin')).toMatch(/private/);
    expect(internalIndicatorReason(ObservableType.URL, 'https://intranet/wiki')).toMatch(/domain/);
    expect(internalIndicatorReason(ObservableType.URL, 'http://[fe80::1]/')).toMatch(/link-local/);
    expect(internalIndicatorReason(ObservableType.URL, 'https://evil-login.net/x')).toBeNull();
    expect(internalIndicatorReason(ObservableType.EMAIL, 'jdoe@contoso.com', own)).not.toBeNull();
    expect(internalIndicatorReason(ObservableType.EMAIL, 'billing@evil-login.net', own)).toBeNull();
  });
});

describe('what an indicator is offered', () => {
  const names = (plan: ReturnType<typeof planLookup>) => plan.options.map((option) => option.name);
  const cmdb: LookupProvider = {
    id: 'cmdb',
    name: 'CMDB',
    enabled: true,
    internal: true,
    templates: {
      [ObservableType.IP]: 'https://cmdb.corp.local/ip/{value}',
      [ObservableType.HOSTNAME]: 'https://cmdb.corp.local/host/{value}',
    },
  };

  it('offers a public address every service that covers addresses', () => {
    expect(names(planLookup(DEFAULT_LOOKUP_PROVIDERS, ObservableType.IP, '185.220.101.4'))).toEqual(
      ['VirusTotal', 'IBM X-Force Exchange', 'AbuseIPDB', 'AlienVault OTX', 'Shodan', 'urlscan.io'],
    );
  });

  it('offers a domain no address-only service such as AbuseIPDB', () => {
    const offered = names(planLookup(DEFAULT_LOOKUP_PROVIDERS, ObservableType.DOMAIN, 'evil.net'));
    expect(offered).toContain('VirusTotal');
    expect(offered).not.toContain('AbuseIPDB');
    expect(offered).not.toContain('Shodan');
  });

  it('offers an internal address no outside service, and says why', () => {
    const plan = planLookup(DEFAULT_LOOKUP_PROVIDERS, ObservableType.IP, '192.168.1.10');
    expect(plan.options).toEqual([]);
    expect(plan.withheld).toMatchObject({ policy: false });
    expect(plan.withheld?.reason).toMatch(/private/);
  });

  it('offers a hostname no outside service, even one saved with an address for it', () => {
    const stale: LookupProvider = {
      ...DEFAULT_LOOKUP_PROVIDERS[0]!,
      templates: { [ObservableType.HOSTNAME]: 'https://www.virustotal.com/gui/domain/{value}' },
    };
    expect(planLookup([stale], ObservableType.HOSTNAME, 'ws-fin-042')).toEqual({
      options: [],
      withheld: null,
    });
  });

  it('withholds outside services under PAP:RED but keeps in-house tools', () => {
    const plan = planLookup([...DEFAULT_LOOKUP_PROVIDERS, cmdb], ObservableType.IP, '8.8.8.8', {
      blockedReason: lookupBlockedReason({ pap: Tlp.RED }),
    });
    expect(names(plan)).toEqual(['CMDB']);
    expect(plan.withheld).toMatchObject({ policy: true });
  });

  it('offers in-house tools for internal indicators and hostnames', () => {
    const providers = [...DEFAULT_LOOKUP_PROVIDERS, cmdb];
    expect(names(planLookup(providers, ObservableType.IP, '10.1.2.3'))).toEqual(['CMDB']);
    expect(names(planLookup(providers, ObservableType.HOSTNAME, 'ws-fin-042'))).toEqual(['CMDB']);
  });

  it('skips a disabled service', () => {
    const off = DEFAULT_LOOKUP_PROVIDERS.map((provider) => ({ ...provider, enabled: false }));
    expect(planLookup(off, ObservableType.IP, '185.220.101.4').options).toEqual([]);
  });
});
