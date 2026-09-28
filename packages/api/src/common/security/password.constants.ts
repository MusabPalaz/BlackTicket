import { Algorithm } from '@node-rs/argon2';

/**
 * Argon2id parameters, following the OWASP Password Storage Cheat Sheet
 * (64 MiB memory, 3 iterations, 4 lanes).
 *
 * Raising these later is safe: stored hashes embed their own parameters, so
 * existing passwords keep verifying and can be re-hashed on next login.
 */
export const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/** Minimum password length enforced everywhere a password is set. */
export const MIN_PASSWORD_LENGTH = 12;

/** How many previous hashes are kept to block password reuse. */
export const PASSWORD_HISTORY_DEPTH = 5;
