import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDENTITY_DOMAIN_POLICY,
  buildEmailFromUsername,
  emailDomainOf,
  isValidDomain,
  isValidUsername,
  normalizeDomain,
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
      expectedDomain: 'blackticket.local',
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
