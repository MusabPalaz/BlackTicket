import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@black-ticket/shared';
import { useAuthStore } from '@/lib/auth-store';

interface RequireAuthProps {
  children: ReactNode;
  /** Route-level permission gate; the API enforces the same rule server-side. */
  permission?: Permission;
  /** Set on the password-rotation screen itself, which must stay reachable. */
  allowPendingPasswordChange?: boolean;
}

export function RequireAuth({
  children,
  permission,
  allowPendingPasswordChange = false,
}: RequireAuthProps) {
  const { user, initializing, hasPermission } = useAuthStore();
  const location = useLocation();

  if (initializing) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-content-muted)]">
        Restoring session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.mustChangePassword && !allowPendingPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  if (permission && !hasPermission(permission)) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Not Authorized</h1>
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">
          Your role ({user.role}) does not include the permission required for this screen.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
