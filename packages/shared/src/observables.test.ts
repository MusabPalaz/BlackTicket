import { describe, expect, it } from 'vitest';
import { ObservableType } from './enums';
import {
  detectObservableType,
  isValidIpv4Cidr,
  extractObservables,
  ipv4InCidr,
  isWhitelisted,
  normalizeEmailAddress,
  normalizeIpv4,
  normalizeIpv6,
  normalizeObservable,
  normalizeRegistryKey,
  normalizeUrl,
  refang,
} from './observables';

/** Convenience: assert that a value normalises to an expected canonical form. */
function normalized(type: ObservableType, value: string): string | null {
  const result = normalizeObservable(type, value);
  return result.ok ? result.value.normalized : null;
}

describe('refang', () => {
  it('undoes the common defanging styles', () => {
    expect(refang('hxxp://evil[.]com/a')).toBe('http://evil.com/a');
    expect(refang('hXXps://evil(.)com')).toBe('https://evil.com');
    expect(refang('user[at]example[.]com')).toBe('user@example.com');
    expect(refang('1.2.3[.]4')).toBe('1.2.3.4');
    expect(refang('evil{.}com')).toBe('evil.com');
  });

  it('leaves ordinary text alone', () => {
    expect(refang('  http://example.com/path  ')).toBe('http://example.com/path');
  });
});

describe('IPv4', () => {
  it('accepts valid addresses', () => {
    expect(normalizeIpv4('1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIpv4(' 255.255.255.255 ')).toBe('255.255.255.255');
  });

  it('rejects out-of-range octets', () => {
    expect(normalizeIpv4('256.1.1.1')).toBeNull();
    expect(normalizeIpv4('1.2.3')).toBeNull();
    expect(normalizeIpv4('1.2.3.4.5')).toBeNull();
  });

  it('rejects leading zeros instead of silently merging them', () => {
    // 1.2.3.004 is not reliably the same host as 1.2.3.4 (octal parsing), so
    // treating them as one indicator would be a guess.
    expect(normalizeIpv4('1.2.3.004')).toBeNull();
    expect(normalizeIpv4('010.1.1.1')).toBeNull();
  });

  it('normalises defanged addresses through the entry point', () => {
    expect(normalized(ObservableType.IP, '185.220.101[.]4')).toBe('185.220.101.4');
  });
});

describe('IPv6', () => {
  it('collapses to the RFC 5952 canonical form', () => {
    expect(normalizeIpv6('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(normalizeIpv6('::0001')).toBe('::1');
    expect(normalizeIpv6('0:0:0:0:0:0:0:0')).toBe('::');
    expect(normalizeIpv6('FE80::0202:B3FF:FE1E:8329')).toBe('fe80::202:b3ff:fe1e:8329');
  });

  it('treats every spelling of one address as the same indicator', () => {
    const spellings = ['2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:DB8:0:0:0:0:0:1'];
    const canonical = spellings.map((value) => normalizeIpv6(value));
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe('2001:db8::1');
  });

  it('handles the embedded IPv4 form', () => {
    expect(normalizeIpv6('::ffff:1.2.3.4')).toBe('::ffff:102:304');
  });

  it('strips brackets and rejects malformed input', () => {
    expect(normalizeIpv6('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeIpv6('2001::db8::1')).toBeNull();
    expect(normalizeIpv6('12345::1')).toBeNull();
    expect(normalizeIpv6('not-an-address')).toBeNull();
  });
});

describe('domains', () => {
  it('lower-cases and strips the trailing dot', () => {
    expect(normalized(ObservableType.DOMAIN, 'Evil.COM.')).toBe('evil.com');
  });

  it('converts internationalised names to punycode', () => {
    // Otherwise the same site written two ways would never correlate.
    expect(normalized(ObservableType.DOMAIN, 'münchen.de')).toBe('xn--mnchen-3ya.de');
    expect(normalized(ObservableType.DOMAIN, 'xn--mnchen-3ya.de')).toBe('xn--mnchen-3ya.de');
  });

  it('refuses values that are not bare domains', () => {
    for (const value of ['http://evil.com', 'evil', 'evil .com', '1.2.3.4', 'a@b.com']) {
      expect(normalized(ObservableType.DOMAIN, value), value).toBeNull();
    }
  });
});

describe('URLs', () => {
  it('lower-cases scheme and host but preserves the path', () => {
    expect(normalizeUrl('HTTP://Evil.COM/Path/To?A=B')).toBe('http://evil.com/Path/To?A=B');
  });

  it('drops default ports and fragments', () => {
    expect(normalizeUrl('http://evil.com:80/a#section')).toBe('http://evil.com/a');
    expect(normalizeUrl('https://evil.com:443')).toBe('https://evil.com');
  });

  it('keeps a non-default port', () => {
    expect(normalizeUrl('http://evil.com:8080/a')).toBe('http://evil.com:8080/a');
  });

  it('refangs before parsing', () => {
    expect(normalized(ObservableType.URL, 'hxxps://evil[.]com/login')).toBe('https://evil.com/login');
  });

  it('rejects unsupported schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('hashes', () => {
  const md5 = 'D41D8CD98F00B204E9800998ECF8427E';
  const sha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
  const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('lower-cases and validates by length', () => {
    expect(normalized(ObservableType.HASH_MD5, md5)).toBe(md5.toLowerCase());
    expect(normalized(ObservableType.HASH_SHA1, sha1)).toBe(sha1);
    expect(normalized(ObservableType.HASH_SHA256, sha256)).toBe(sha256);
  });

  it('rejects a hash filed under the wrong algorithm', () => {
    expect(normalized(ObservableType.HASH_SHA256, md5)).toBeNull();
  });

  it('rejects non-hex and wrong lengths', () => {
    expect(normalized(ObservableType.HASH_MD5, 'zzzz')).toBeNull();
    expect(normalized(ObservableType.HASH_MD5, 'abc123')).toBeNull();
  });
});

describe('e-mail addresses', () => {
  it('lower-cases and normalises the domain', () => {
    expect(normalizeEmailAddress('John.Doe@Example.COM')).toBe('john.doe@example.com');
  });

  it('rejects an ambiguous address with several @ signs', () => {
    // Unquoted, this is not a valid address; picking a separator would be a
    // guess, and a wrong guess creates an indicator that never correlates.
    expect(normalizeEmailAddress('weird@name@example.com')).toBeNull();
  });

  it('rejects malformed addresses', () => {
    for (const value of ['no-at-sign', '@example.com', 'a@', 'a@b', 'a b@example.com']) {
      expect(normalizeEmailAddress(value), value).toBeNull();
    }
  });
});

describe('registry keys', () => {
  it('expands hive abbreviations and normalises separators', () => {
    expect(normalizeRegistryKey('HKLM\\Software\\Run')).toBe('hkey_local_machine\\software\\run');
    expect(normalizeRegistryKey('HKCU/Software//Run')).toBe('hkey_current_user\\software\\run');
  });
});

describe('free-form types', () => {
  it('lower-cases usernames and filenames', () => {
    expect(normalized(ObservableType.USERNAME, 'Administrator')).toBe('administrator');
    expect(normalized(ObservableType.FILENAME, 'Invoice.DOC')).toBe('invoice.doc');
  });

  it('keeps case for mutexes and user agents', () => {
    expect(normalized(ObservableType.MUTEX, 'Global\\MyMutex')).toBe('Global\\MyMutex');
    expect(normalized(ObservableType.USER_AGENT, 'Mozilla/5.0   (X11)')).toBe('Mozilla/5.0 (X11)');
  });

  it('rejects empty and oversized values', () => {
    expect(normalizeObservable(ObservableType.OTHER, '   ').ok).toBe(false);
    expect(normalizeObservable(ObservableType.OTHER, 'a'.repeat(3_000)).ok).toBe(false);
  });
});

describe('type detection', () => {
  it('recognises each family', () => {
    expect(detectObservableType('https://evil.com/a')).toBe(ObservableType.URL);
    expect(detectObservableType('185.220.101.4')).toBe(ObservableType.IP);
    expect(detectObservableType('2001:db8::1')).toBe(ObservableType.IP);
    expect(detectObservableType('d41d8cd98f00b204e9800998ecf8427e')).toBe(ObservableType.HASH_MD5);
    expect(detectObservableType('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(
      ObservableType.HASH_SHA256,
    );
    expect(detectObservableType('user@example.com')).toBe(ObservableType.EMAIL);
    expect(detectObservableType('HKLM\\Software\\Run')).toBe(ObservableType.REGISTRY_KEY);
    expect(detectObservableType('evil.com')).toBe(ObservableType.DOMAIN);
  });

  it('returns null when it cannot tell', () => {
    expect(detectObservableType('just some words')).toBeNull();
  });
});

describe('bulk extraction', () => {
  const sample = `
    Received: from mail.evil-domain[.]com (185.220.101[.]4)
    Reply-To: billing@evil-domain.com
    Link: hxxps://login.evil-domain[.]com/sso?next=/portal
    Attachment sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    Internal relay 10.0.0.25 and IPv6 2001:0db8::0001
  `;

  const found = extractObservables(sample);
  const byType = (type: ObservableType) =>
    found.filter((entry) => entry.type === type).map((entry) => entry.normalized);

  it('finds indicators through the defanging', () => {
    expect(byType(ObservableType.IP)).toEqual(
      expect.arrayContaining(['185.220.101.4', '10.0.0.25', '2001:db8::1']),
    );
    expect(byType(ObservableType.URL)).toEqual(['https://login.evil-domain.com/sso?next=/portal']);
    expect(byType(ObservableType.EMAIL)).toEqual(['billing@evil-domain.com']);
    expect(byType(ObservableType.HASH_SHA256)).toEqual([
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ]);
  });

  it('does not report a URL host or a mail domain as a bare domain twice', () => {
    const domains = byType(ObservableType.DOMAIN);
    expect(domains).toContain('mail.evil-domain.com');
    expect(domains).not.toContain('login.evil-domain.com');
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('deduplicates repeated indicators', () => {
    const repeated = extractObservables('1.2.3.4 1.2.3.4 1[.]2[.]3[.]4');
    expect(repeated.filter((entry) => entry.type === ObservableType.IP)).toHaveLength(1);
  });
});

describe('CIDR validation', () => {
  it('accepts well-formed blocks', () => {
    for (const value of ['10.0.0.0/8', '192.168.0.0/16', '0.0.0.0/0', '1.2.3.4/32']) {
      expect(isValidIpv4Cidr(value), value).toBe(true);
    }
  });

  it('rejects malformed ones, so a rule cannot silently never match', () => {
    for (const value of ['10.0.0.0', '10.0.0.0/33', '10.0.0.0/-1', '300.0.0.0/8', '10.0.0.0/8/8', 'evil.com/8']) {
      expect(isValidIpv4Cidr(value), value).toBe(false);
    }
  });
});

describe('whitelist matching', () => {
  it('matches IPv4 CIDR blocks', () => {
    expect(ipv4InCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipv4InCidr('11.1.2.3', '10.0.0.0/8')).toBe(false);
    expect(ipv4InCidr('192.168.5.9', '192.168.0.0/16')).toBe(true);
    expect(ipv4InCidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
    expect(ipv4InCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('excludes internal ranges from correlation', () => {
    const rules = [{ type: ObservableType.IP, pattern: '10.0.0.0/8', isCidr: true }];
    expect(isWhitelisted({ type: ObservableType.IP, normalized: '10.0.0.25' }, rules)).toBe(true);
    expect(isWhitelisted({ type: ObservableType.IP, normalized: '185.220.101.4' }, rules)).toBe(false);
  });

  it('supports wildcard domain suffixes without matching look-alikes', () => {
    const rules = [{ type: ObservableType.DOMAIN, pattern: '*.microsoft.com', isCidr: false }];
    expect(isWhitelisted({ type: ObservableType.DOMAIN, normalized: 'login.microsoft.com' }, rules)).toBe(true);
    expect(isWhitelisted({ type: ObservableType.DOMAIN, normalized: 'microsoft.com' }, rules)).toBe(true);
    expect(isWhitelisted({ type: ObservableType.DOMAIN, normalized: 'notmicrosoft.com' }, rules)).toBe(false);
    expect(isWhitelisted({ type: ObservableType.DOMAIN, normalized: 'microsoft.com.evil.ru' }, rules)).toBe(false);
  });

  it('never matches across types', () => {
    const rules = [{ type: ObservableType.DOMAIN, pattern: 'evil.com', isCidr: false }];
    expect(isWhitelisted({ type: ObservableType.URL, normalized: 'evil.com' }, rules)).toBe(false);
  });
});
