import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';
import type { PrismaService } from '../../prisma/prisma.service';

// checkStrength is pure; the database is only touched by the history methods.
const passwords = new PasswordService({} as PrismaService);

const account = { username: 'admin', email: 'admin@blackticket.local', fullName: 'System Administrator' };

describe('password strength policy', () => {
  it('rejects the password-spraying classics', () => {
    // Measured against our own dictionary these score 3 and even 4 on the
    // zxcvbn 0-4 scale, which is exactly why the gate is the guess count.
    const sprayable = [
      'Summer2026!!',
      'Winter2026!',
      'Autumn2025!!',
      'Company#2026',
      'Qwerty123456!',
      'Password1234',
      'Blackticket2026!',
    ];

    for (const candidate of sprayable) {
      const result = passwords.checkStrength(candidate, account);
      expect(result.ok, `${candidate} must be rejected`).toBe(false);
    }
  });

  it('rejects passwords built around the account name', () => {
    for (const candidate of ['Admin!2026Soc', 'admin-quartz-lantern-1997', 'xxadminxx-tundra-99']) {
      const result = passwords.checkStrength(candidate, account);
      expect(result.ok, candidate).toBe(false);
      if (!result.ok) expect(result.message).toContain('account name');
    }
  });

  it('accepts real passphrases and random strings', () => {
    for (const candidate of [
      'harbor-quartz-lantern-97',
      'meadow copper signal thistle',
      'kX9$mfQ2vLp8',
      'gravel-plume-thistle-58',
    ]) {
      const result = passwords.checkStrength(candidate, account);
      expect(result.ok, `${candidate} should be accepted`).toBe(true);
    }
  });

  it('enforces the length floor before anything else', () => {
    const result = passwords.checkStrength('kX9$mfQ2v', account);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('at least 12');
  });

  it('rejects absurdly long input instead of hashing it', () => {
    const result = passwords.checkStrength('a'.repeat(300), account);
    expect(result.ok).toBe(false);
  });

  it('explains why a password failed', () => {
    const result = passwords.checkStrength('Summer2026!!', account);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/too easy to guess/i);
      // The zxcvbn feedback must be translated, not a raw message key.
      expect(result.message).not.toMatch(/similarToCommon|useAFewWords/);
    }
  });
});
