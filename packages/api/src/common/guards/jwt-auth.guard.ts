import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { TokenService } from '../../modules/auth/token.service';
import { UsersService } from '../../modules/users/users.service';
import type { RequestWithUser } from '../types/request.types';

/**
 * Verifies the bearer token and loads the account behind it.
 *
 * The user is re-read from the database on every request rather than trusted
 * from the token claims: a disabled account, a demoted role or a forced logout
 * has to take effect immediately, not whenever the access token happens to
 * expire.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = JwtAuthGuard.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let userId: string;
    try {
      userId = this.tokens.verifyAccessToken(token).sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.status === 'DISABLED') {
      throw new UnauthorizedException('Account is disabled');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Account is locked');
    }

    (request as RequestWithUser).user = user;
    return true;
  }

  private static extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
