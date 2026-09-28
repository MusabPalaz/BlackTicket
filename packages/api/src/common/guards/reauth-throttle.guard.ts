import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import type { AppEnv } from '../config/env.config';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limit for the endpoints that re-verify a password inside a session.
 *
 * Signing in is not the only place this application checks a password: changing
 * one, turning off two-factor and unlocking the organisation domain all do it
 * too. Those sit behind an authenticated session, so `LoginThrottleGuard` never
 * sees them and only the global per-IP limit applies — which at its default
 * leaves a password oracle open at three hundred guesses a minute to anyone
 * holding a stolen session, or to an insider guessing a colleague's password
 * because people reuse them.
 *
 * Counted per account rather than per IP: the attacker here is already inside a
 * session, so their address proves nothing about how many attempts they have
 * made.
 */
@Injectable()
export class ReauthThrottleGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private static readonly WINDOW_MS = 60_000;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: User }>();
    // Falls back to the address only if the guard is somehow reached without a
    // session; every route it is used on is authenticated.
    const key = request.user?.id ?? `ip:${request.ip ?? 'unknown'}`;
    const limit = this.config.get('RATE_LIMIT_REAUTH_PER_MIN', { infer: true });
    const now = Date.now();

    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + ReauthThrottleGuard.WINDOW_MS });
      return true;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many attempts. Try again in ${retryAfter} seconds.`,
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
