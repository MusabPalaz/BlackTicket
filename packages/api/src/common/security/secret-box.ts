import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

/**
 * Authenticated encryption for secrets that must be recoverable — today only
 * TOTP seeds, which cannot be hashed because the server has to recompute codes.
 *
 * A database dump alone therefore does not hand an attacker working second
 * factors; the encryption key lives in the environment, not in the database.
 *
 * Format: v1.<iv>.<authTag>.<ciphertext>, all base64url.
 */
const VERSION = 'v1';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function deriveKey(masterKey: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(masterKey, 'utf8'), Buffer.alloc(0), Buffer.from(purpose), KEY_LENGTH),
  );
}

export function encryptSecret(plaintext: string, masterKey: string, purpose = 'totp'): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(masterKey, purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string, masterKey: string, purpose = 'totp'): string {
  const [version, ivPart, tagPart, dataPart] = payload.split('.');
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted secret');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(masterKey, purpose),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
