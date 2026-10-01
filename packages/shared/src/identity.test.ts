import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDENTITY_DOMAIN_POLICY,
  buildEmailFromUsername,
  emailDomainOf,
  formatDomainList,
  isValidDomain,
  isValidUsername,
  normalizeDomain,
  organisationDomains,
  validateEmailAgainstPolicy,
  type IdentityDomainPolicy,
} from './identity';

const locked: IdentityDomainPolicy = {
  domain: 'blackticket.local',
  locked: true,
  updatedAt: null,
  updatedById: null,
};

describe('domain normalisation', () => {
  it('strips a leading @, a trailing dot and case', () => {
    expect(normalizeDomain('@BlackTicket.Local.')).toBe('blackticket.local');
  });

  it('accepts realistic domains', () => {
    for (const domain of ['blackticket.local', 'soc.example.com', 'a-b.co.uk']) {
      expect(isValidDomain(domain), domain).toBe(true);
    }
  });

  it('rejects things that are not bare domains', () => {
    for (const value of [
      'https://blackticket.local',
      'user@blackticket.local',
      'blackticket',
      'black ticket.local',
      '-bad.local',
      'bad-.local',
      '',
    ]) {
      expect(isValidDomain(value), value).toBe(false);
    }
  });
});

describe('e-mail policy', () => {
  it('accepts any valid address while no domain is configured', () => {
    const result = validateEmailAgainstPolicy('someone@anywhere.com', DEFAULT_IDENTITY_DOMAIN_POLICY);
    expect(result).toEqual({ ok: true, email: 'someone@anywhere.com' });
  });

  it('accepts an address inside the configured domain, case-insensitively', () => {
    expect(validateEmailAgainstPolicy('Jane.Doe@BlackTicket.Local', locked)).toEqual({
      ok: true,
      email: 'jane.doe@blackticket.local',
    });
  });

  it('rejects an address outside the configured domain', () => {
    expect(validateEmailAgainstPolicy('jane@gmail.com', locked)).toEqual({
      ok: false,
      reason: 'DOMAIN_MISMATCH',
      expectedDomains: ['blackticket.local'],
    });
  });

  it('is not fooled by a domain that merely ends with the configured one', () => {
    // "notblackticket.local" ends with "blackticket.local" as a string.
    expect(validateEmailAgainstPolicy('jane@notblackticket.local', locked).ok).toBe(false);
    expect(validateEmailAgainstPolicy('jane@evil.com?x=@blackticket.local', locked).ok).toBe(false);
  });

  it('takes the last @ as the separator', () => {
    expect(emailDomainOf('weird@name@blackticket.local')).toBe('blackticket.local');
  });

  it('rejects malformed addresses', () => {
    for (const value of ['no-at-sign', '@nothing.local', 'spaces in@name.local', 'a@']) {
      expect(validateEmailAgainstPolicy(value, locked).ok, value).toBe(false);
    }
  });
});

describe('several organisation domains', () => {
  // One directory tenant, several mail domains: the case that motivated the list.
  const group: IdentityDomainPolicy = {
    ...locked,
    additionalDomains: ['meridian.com', 'Meridian-Bank.co.uk', 'blackticket.local'],
  };

  it('lists the primary first, normalised and without repeats', () => {
    expect(organisationDomains(group)).toEqual([
      'blackticket.local',
      'meridian.com',
      'meridian-bank.co.uk',
    ]);
  });

  it('treats a policy saved before the list existed as primary-only', () => {
    const legacy = {
      domain: 'blackticket.local',
      locked: true,
      updatedAt: null,
      updatedById: null,
    };
    expect(organisationDomains(legacy)).toEqual(['blackticket.local']);
    expect(validateEmailAgainstPolicy('jane@blackticket.local', legacy).ok).toBe(true);
  });

  it('ignores extra domains while no primary is set', () => {
    const orphaned = { ...DEFAULT_IDENTITY_DOMAIN_POLICY, additionalDomains: ['meridian.com'] };
    expect(organisationDomains(orphaned)).toEqual([]);
    expect(validateEmailAgainstPolicy('jane@gmail.com', orphaned).ok).toBe(true);
  });

  it('accepts an address in any of the domains', () => {
    for (const email of ['a@blackticket.local', 'b@meridian.com', 'C@MERIDIAN-BANK.CO.UK']) {
      expect(validateEmailAgainstPolicy(email, group).ok, email).toBe(true);
    }
  });

  it('rejects an address outside all of them and names every one', () => {
    expect(validateEmailAgainstPolicy('jane@gmail.com', group)).toEqual({
      ok: false,
      reason: 'DOMAIN_MISMATCH',
      expectedDomains: ['blackticket.local', 'meridian.com', 'meridian-bank.co.uk'],
    });
  });

  it('matches whole domains only', () => {
    expect(validateEmailAgainstPolicy('jane@sub.meridian.com', group).ok).toBe(false);
    expect(validateEmailAgainstPolicy('jane@notmeridian.com', group).ok).toBe(false);
  });

  it('still derives addresses from the primary domain', () => {
    expect(buildEmailFromUsername('jdoe', group)).toBe('jdoe@blackticket.local');
  });

  it('formats the list for messages', () => {
    expect(formatDomainList(['a.com'])).toBe('@a.com');
    expect(formatDomainList(['a.com', 'b.com'])).toBe('@a.com or @b.com');
    expect(formatDomainList(['a.com', 'b.com', 'c.com'])).toBe('@a.com, @b.com or @c.com');
  });
});

describe('username handling', () => {
  it('accepts ordinary account names', () => {
    for (const name of ['jdoe', 'jane.doe', 'soc_l1', 'a-b-c']) {
      expect(isValidUsername(name), name).toBe(true);
    }
  });

  it('rejects names that would break address derivation', () => {
    for (const name of ['ab', 'jane doe', 'jane@doe', 'jane/doe', '']) {
      expect(isValidUsername(name), name).toBe(false);
    }
  });

  it('derives the address from the configured domain', () => {
    expect(buildEmailFromUsername('JDoe', locked)).toBe('jdoe@blackticket.local');
  });

  it('cannot derive an address before a domain exists', () => {
    expect(buildEmailFromUsername('jdoe', DEFAULT_IDENTITY_DOMAIN_POLICY)).toBeNull();
  });
});
