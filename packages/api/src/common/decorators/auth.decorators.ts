import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Permission } from '@black-ticket/shared';
import type { RequestWithUser } from '../types/request.types';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';
export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'auth:allowPendingPasswordChange';

/** Marks a route as reachable without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Declares the permissions a route requires. Enforced by PermissionsGuard —
 * a route with no declaration is authenticated but unrestricted, so anything
 * role-sensitive must declare explicitly.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Allows a route to be used while the account still owes a password change —
 * only the endpoints needed to complete or abandon that flow.
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): User => {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  return request.user;
});
