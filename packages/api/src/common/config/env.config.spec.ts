import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.config';

const required = {
  DATABASE_URL: 'postgresql://blackticket:secret@localhost:5432/blackticket',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  TOTP_ENCRYPTION_KEY: 'c'.repeat(32),
};

describe('TRUST_PROXY', () => {
  it('believes no proxy unless told to', () => {
    expect(validateEnv(required).TRUST_PROXY).toBe(false);
    expect(validateEnv({ ...required, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('takes a hop count as a number, as Express expects', () => {
    expect(validateEnv({ ...required, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
  });

  it('passes an address list through to Express', () => {
    expect(validateEnv({ ...required, TRUST_PROXY: '10.0.0.0/8, loopback' }).TRUST_PROXY).toBe(
      '10.0.0.0/8, loopback',
    );
  });

  it('refuses to believe every client', () => {
    expect(() => validateEnv({ ...required, TRUST_PROXY: 'true' })).toThrow(/X-Forwarded-For/);
  });
});

describe('APP_VERSION', () => {
  it('reads as dev when nothing sets it', () => {
    expect(validateEnv(required).APP_VERSION).toBe('dev');
  });

  it('carries the release the compose file passes in', () => {
    expect(validateEnv({ ...required, APP_VERSION: ' v1.4.0 ' }).APP_VERSION).toBe('v1.4.0');
  });
});
