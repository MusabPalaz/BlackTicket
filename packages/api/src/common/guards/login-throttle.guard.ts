import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { normalizeUsername } from '@black-ticket/shared';
import type { AppEnv } from '../config/env.config';

/**
 * Set on `response.locals` by the sign-in handler when an attempt was refused
 * for its credentials, so the guard can count it once the response is sent.
 */
export const LOGIN_CREDENTIAL_FAILURE = 'loginCredentialFailure';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limits for the sign-in endpoint, in two counts.
 *
 * Per source and username, every attempt: one address hammering one account.
 * The username is normalised exactly as sign-in normalises it, so " Admin" and
 * "admin" are the same account here too, not a fresh allowance each.
 *
 * Per source, failures only: one address walking a user list with a common
 * password. The first count cannot see that — every username starts a new
 * pair — and the account lockout cannot either, since each account sees only
 * one guess. Only failures are counted so that an office behind one NAT
 * address can still sign in all at once at the start of a shift; a correct
 * password that is only waiting for its second factor is not a failure.
 *
 * In-memory by design: with a single API instance this is exact, and it costs
 * no extra infrastructure. Behind multiple instances it becomes per-instance
 * and the DB-backed lockout remains the hard limit.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly attempts = new Map<string, Bucket>();
  private readonly failures = new Map<string, Bucket>();
  private static readonly WINDOW_MS = 60_000;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const username = (request.body as { username?: unknown } | undefined)?.username;
    const source = LoginThrottleGuard.sourceOf(request);
    const now = Date.now();

    LoginThrottleGuard.sweep(this.attempts, now);
    LoginThrottleGuard.sweep(this.failures, now);

    // Failures are only counted after the fact, so the budget is spent once
    // the count reaches the limit, not when it passes it.
    const failures = this.failures.get(source);
    if (failures && failures.resetAt > now) {
      LoginThrottleGuard.refuseIfOver(
        failures.count + 1,
        this.config.get('RATE_LIMIT_LOGIN_FAILURES_PER_IP_PER_MIN', { infer: true }),
        failures.resetAt,
        now,
      );
    }

    // Counted once the answer is known; the handler marks a credential failure.
    const response = context.switchToHttp().getResponse<Response>();
    response.once('finish', () => {
      if (response.locals[LOGIN_CREDENTIAL_FAILURE] === true) {
        LoginThrottleGuard.hit(this.failures, source, Date.now());
      }
    });

    const key = `${source}|${typeof username === 'string' ? normalizeUsername(username) : ''}`;
    const bucket = LoginThrottleGuard.hit(this.attempts, key, now);
    LoginThrottleGuard.refuseIfOver(
      bucket.count,
      this.config.get('RATE_LIMIT_LOGIN_PER_MIN', { infer: true }),
      bucket.resetAt,
      now,
    );

    return true;
  }

  private static sourceOf(request: Request): string {
    return request.ip ?? 'unknown';
  }

  private static hit(buckets: Map<string, Bucket>, key: string, now: number): Bucket {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + LoginThrottleGuard.WINDOW_MS };
      buckets.set(key, fresh);
      return fresh;
    }
    bucket.count += 1;
    return bucket;
  }

  private static refuseIfOver(count: number, limit: number, resetAt: number, now: number): void {
    if (count <= limit) return;
    const retryAfter = Math.ceil((resetAt - now) / 1000);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Too many sign-in attempts. Try again in ${retryAfter} seconds.`,
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Keeps the maps from growing without bound on a long-running process. */
  private static sweep(buckets: Map<string, Bucket>, now: number): void {
    if (buckets.size < 1_000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }
}
