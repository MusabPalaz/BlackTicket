import { generateSync } from 'otplib';

/**
 * Sign-in helper for the end-to-end scripts.
 *
 * Accounts that have two-factor authentication enabled cannot be driven by a
 * password alone. Rather than weaken an account so the tests can reach it, the
 * seed is supplied out of band:
 *
 *   BT_TOTP_ADMIN=JBSWY3DPEHPK3PXP npx tsx scripts/phase5-e2e.ts
 *
 * The variable is read per account (`BT_TOTP_<USERNAME>`, upper case, dashes
 * and dots as underscores) and only ever used here, in a developer's shell.
 */
export const API = 'http://localhost:3000/api/v1';

/**
 * The administrator the phase suites drive.
 *
 * The seeded account is the default. Anything else — a rotated password, or a
 * second administrator kept without a second factor so the suites can run — is
 * supplied out of band, the same way the TOTP seeds are:
 *
 *   BT_ADMIN_USER=admin2 BT_ADMIN_PASS=<password> npx tsx scripts/phase2-e2e.ts
 *
 * Nothing is written down here: the value is read from the environment of the
 * shell that runs the suite and used only to sign in.
 */
export function adminAccount(): readonly [string, string] {
  // Read on demand rather than at import, so the suites that never sign in as
  // an administrator (phase55, session-changes-check) do not need it set.
  const password = process.env.BT_ADMIN_PASS;
  if (!password) {
    throw new Error(
      'BT_ADMIN_PASS is not set. Pass the administrator password for this run, e.g.\n' +
        '  BT_ADMIN_PASS=<password> npx tsx scripts/phase2-e2e.ts',
    );
  }
  return [process.env.BT_ADMIN_USER ?? 'admin', password];
}

export interface LoginResult {
  status: number;
  body: {
    accessToken?: string;
    refreshToken?: string;
    code?: string;
    message?: string;
    user?: { username: string; mustChangePassword: boolean; totpEnabled: boolean };
  } | null;
}

function totpSecretFor(username: string): string | undefined {
  const key = `BT_TOTP_${username.toUpperCase().replace(/[.-]/g, '_')}`;
  return process.env[key];
}

/**
 * One sign-in request, answered exactly as the server answered it.
 *
 * Use this when the refusal is the thing under test — `signIn` below escalates
 * to a second factor on your behalf, which is convenient everywhere except in
 * the assertion that a second factor is demanded at all.
 */
export async function attemptSignIn(
  username: string,
  password: string,
  totpCode?: string,
): Promise<LoginResult> {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ...(totpCode ? { totpCode } : {}) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export async function signIn(username: string, password: string): Promise<LoginResult> {
  const attempt = (totpCode?: string): Promise<LoginResult> =>
    attemptSignIn(username, password, totpCode);

  const first = await attempt();
  if (first.body?.code !== 'TOTP_REQUIRED') return first;

  const secret = totpSecretFor(username);
  if (!secret) {
    throw new Error(
      `${username} has two-factor authentication enabled. Re-run with BT_TOTP_${username
        .toUpperCase()
        .replace(/[.-]/g, '_')}=<base32 seed>, or use an account without 2FA.`,
    );
  }

  return attempt(generateSync({ strategy: 'totp', secret }));
}

/** Signs in every account in a map and returns their access tokens. */
export async function signInAll<T extends Record<string, readonly [string, string]>>(
  accounts: T,
): Promise<Map<keyof T, string>> {
  const tokens = new Map<keyof T, string>();

  for (const [who, [username, password]] of Object.entries(accounts)) {
    const result = await signIn(username, password);
    if (!result.body?.accessToken) {
      throw new Error(
        `cannot sign in as ${username}: ${result.body?.message ?? `HTTP ${result.status}`}`,
      );
    }
    tokens.set(who as keyof T, result.body.accessToken);
  }

  return tokens;
}
