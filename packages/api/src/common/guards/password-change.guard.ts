import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_PENDING_PASSWORD_CHANGE_KEY,
  IS_PUBLIC_KEY,
} from '../decorators/auth.decorators';
import type { RequestWithUser } from '../types/request.types';

/**
 * An account carrying a bootstrap or admin-reset password can do exactly one
 * thing: change that password. Without this, "must change password" would be a
 * UI suggestion that any API client could ignore.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const bypass = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass || isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user?.mustChangePassword) {
      throw new ForbiddenException({
        message: 'Password change required before using the application.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    return true;
  }
}
