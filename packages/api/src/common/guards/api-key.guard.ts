import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ApiKey } from '@prisma/client';
import { ApiKeyScope } from '@black-ticket/shared';
import { ApiKeysService } from '../../modules/apikeys/apikeys.service';
import { API_KEY_SCOPES_KEY } from '../decorators/api-key.decorators';
import type { AppEnv } from '../config/env.config';

export interface RequestWithApiKey extends Request {
  apiKey: ApiKey;
}

/**
 * Machine authentication for the endpoints a system, not a person, calls.
 *
 * Rate limiting lives here rather than in the global throttler because the
 * meaningful unit is the key, not the IP: every alert from one SIEM arrives
 * from the same address, and one misconfigured integration must not be able to
 * drown out the others.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const required =
      this.reflector.getAllAndOverride<ApiKeyScope[]>(API_KEY_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const value = presentedKey(request);
    if (!value) {
      throw new UnauthorizedException('Missing API key');
    }

    const key = await this.apiKeys.resolve(value);
    if (!key) {
      // Deliberately identical for unknown, revoked and expired keys.
      throw new UnauthorizedException('Invalid API key');
    }

    /*
     * A key minted for one integration has to be useless for another: an
     * ingest token that could also create accounts would turn an alert feed
     * into a way into the directory.
     */
    const missing = required.filter((scope) => !key.scopes.includes(scope));
    if (missing.length > 0) {
      throw new ForbiddenException(`This key lacks the ${missing.join(', ')} scope.`);
    }

    this.enforceRateLimit(key.id, required);
    await this.apiKeys.touch(key);

    (request as RequestWithApiKey).apiKey = key;
    return true;
  }

  private enforceRateLimit(keyId: string, required: ApiKeyScope[]): void {
    /*
     * A directory sync is bursty in a way an alert feed is not: the first run
     * against 600 accounts arrives as fast as the provider can send it, and
     * holding that to the ingest budget would stall the initial import.
     */
    const limit = required.includes(ApiKeyScope.SCIM_MANAGE)
      ? this.config.get('RATE_LIMIT_SCIM_PER_MIN', { infer: true })
      : this.config.get('RATE_LIMIT_INGEST_PER_MIN', { infer: true });
    const now = Date.now();
    const bucket = this.buckets.get(keyId);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(keyId, { count: 1, resetAt: now + 60_000 });
      return;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Limit of ${limit} requests per minute exceeded. Retry in ${retryAfter}s.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/**
 * Accepts either header.
 *
 * The SIEM integrations use `X-Api-Key`. Entra's SCIM provisioning sends its
 * secret token as `Authorization: Bearer` and offers no way to change that, so
 * one key mechanism has to answer to both spellings.
 */
function presentedKey(request: Request): string | null {
  const header = request.headers['x-api-key'];
  const direct = Array.isArray(header) ? header[0] : header;
  if (direct) return direct;

  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim() || null;

  return null;
}
