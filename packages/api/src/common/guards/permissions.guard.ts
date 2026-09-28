import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditAction, type Permission, type Role, can } from '@black-ticket/shared';
import { AuditService } from '../../modules/audit/audit.service';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators/auth.decorators';
import type { RequestWithUser } from '../types/request.types';

/**
 * Enforces the shared RBAC matrix. Route-level permissions are the coarse gate;
 * ownership rules (`*_OWN` vs `*_ANY`) are resolved in the services, which are
 * the only place that knows who reported or is assigned to a record.
 *
 * Refusals are written to the audit trail. Somebody repeatedly reaching for
 * screens their role does not grant is exactly the signal this product exists
 * to capture for its customers, and it would be odd for the product not to
 * capture it about itself.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const role = request.user?.role as Role | undefined;
    if (!role) {
      this.recordDenial(request, required, 'NO_ROLE');
      throw new ForbiddenException('Not authorized');
    }

    const missing = required.filter((permission) => !can(role, permission));
    if (missing.length > 0) {
      this.recordDenial(request, missing, 'MISSING_PERMISSION');
      // The missing permission is named on purpose: this is an internal tool,
      // and "you lack user:manage" beats a bare 403 for an operator.
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }

    return true;
  }

  /**
   * Deliberately not awaited: a guard must decide now, and the audit service
   * already swallows and logs its own failures. A trail write that is slow, or
   * a database that is briefly unavailable, must not turn an authorization
   * decision into a 500.
   */
  private recordDenial(
    request: RequestWithUser,
    permissions: Permission[],
    reason: string,
  ): void {
    void this.audit.record({
      action: AuditAction.ACCESS_DENIED,
      entityType: 'Route',
      entityId: `${request.method} ${request.route?.path ?? request.path}`,
      actorId: request.user?.id ?? null,
      actorIp: request.ip ?? null,
      actorUserAgent: request.get?.('user-agent') ?? null,
      metadata: { reason, required: permissions, role: request.user?.role ?? null },
    });
  }
}
