import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppEnv } from '../config/env.config';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-IP-and-username rate limit for the sign-in endpoint.
 *
 * The global throttler counts by IP alone, which a password-spraying attacker
 * defeats by rotating usernames. Counting the pair as well means one source
 * cannot walk a user list, while the account lockout in AuthService handles the
 * complementary case of many sources against one account.
 *
 * In-memory by design: with a single API instance this is exact, and it costs
 * no extra infrastructure. Behind multiple instances it becomes per-instance
 * and the DB-backed lockout remains the hard limit.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private static readonly WINDOW_MS = 60_000;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const username = (request.body as { username?: unknown } | undefined)?.username;
    const key = `${request.ip ?? 'unknown'}|${typeof username === 'string' ? username.toLowerCase() : ''}`;
    const limit = this.config.get('RATE_LIMIT_LOGIN_PER_MIN', { infer: true });
    const now = Date.now();

    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + LoginThrottleGuard.WINDOW_MS });
      return true;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many sign-in attempts. Try again in ${retryAfter} seconds.`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /** Keeps the map from growing without bound on a long-running process. */
  private sweep(now: number): void {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
