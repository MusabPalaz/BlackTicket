import { z } from 'zod';

/**
 * Environment contract.
 *
 * Validated once at boot: a missing or malformed variable stops the process
 * immediately instead of surfacing as a confusing runtime failure later. Secrets
 * are length-checked here because a short JWT secret is a real vulnerability,
 * not a configuration preference.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().url(),
  /**
   * Connections this instance keeps to PostgreSQL.
   *
   * Sized against concurrent *requests*, not users: a list endpoint runs its
   * page and its count in parallel and so holds two at once. Twenty was
   * measurably too few at the target load — requests spent their time queueing
   * for a connection rather than in the database. Raise it only together with
   * PostgreSQL's own max_connections.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(200).default(50),

  /**
   * Where the browser is sent back to after a federated sign-in. The API
   * cannot infer it: the identity provider redirects to the API, and only
   * this says which front end that API belongs to.
   */
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  /** Encrypts TOTP seeds at rest — they must be recoverable, so they cannot be hashed. */
  TOTP_ENCRYPTION_KEY: z
    .string()
    .min(32, 'TOTP_ENCRYPTION_KEY must be at least 32 characters'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().positive().default(10),
  /** Password re-checks inside a session: change password, disable 2FA,
   *  unlock the organisation domain. Counted per account. */
  RATE_LIMIT_REAUTH_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_INGEST_PER_MIN: z.coerce.number().int().positive().default(100),
  /** A directory sync arrives in bursts an alert feed never does. */
  RATE_LIMIT_SCIM_PER_MIN: z.coerce.number().int().positive().default(600),

  CORRELATION_FANOUT_LIMIT: z.coerce.number().int().positive().default(50),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  if (result.data.JWT_ACCESS_SECRET === result.data.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ — sharing one secret ' +
        'lets an access token be replayed as a refresh token.',
    );
  }

  return result.data;
}
