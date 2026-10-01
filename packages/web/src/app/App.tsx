import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Permission } from '@black-ticket/shared';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './RequireAuth';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { SsoCallbackPage } from '@/features/auth/SsoCallbackPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { IdentityDomainPage } from '@/features/admin/IdentityDomainPage';
import { SsoSettingsPage } from '@/features/admin/SsoSettingsPage';
import { CasesListPage } from '@/features/cases/CasesListPage';
import { NewCasePage } from '@/features/cases/NewCasePage';
import { CaseWorkspacePage } from '@/features/cases/CaseWorkspacePage';
import { ObservablesPage } from '@/features/observables/ObservablesPage';
import { WhitelistPage } from '@/features/admin/WhitelistPage';
import { LookupProvidersPage } from '@/features/admin/LookupProvidersPage';
import { ApiKeysPage } from '@/features/admin/ApiKeysPage';
import { UserImportPage } from '@/features/admin/UserImportPage';
import { AuditLogPage } from '@/features/admin/AuditLogPage';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { SystemPage } from '@/features/admin/SystemPage';
import { PlaybooksPage } from '@/features/admin/PlaybooksPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { AlertsPage } from '@/features/alerts/AlertsPage';
import { UsersPage } from '@/features/admin/UsersPage';
import { useAuthStore } from '@/lib/auth-store';
import { UNAUTHENTICATED_EVENT } from '@/lib/token-storage';
import { DEFAULT_THEME, paintTheme, setTheme, useTheme } from '@/lib/theme';

/**
 * Route table for the whole product. Every screen here is real — the phased
 * placeholders are gone as of Phase 4.
 */
export function App() {
  const restore = useAuthStore((state) => state.restore);
  const clearSession = useAuthStore((state) => state.clearSession);
  const signedIn = useAuthStore((state) => state.user !== null);
  const initializing = useAuthStore((state) => state.initializing);
  const theme = useTheme();
  const queryClient = useQueryClient();

  // The sign-in screen is the product's front door and always wears the
  // default; a person's own theme starts once they are in. While the session
  // is still being restored the first paint stands, so nothing flickers.
  useEffect(() => {
    if (initializing) return;
    paintTheme(signedIn ? theme : DEFAULT_THEME);
  }, [initializing, signedIn, theme]);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Cached responses belong to the account that fetched them, and no query key
  // names a user. Signing in as someone else in the same tab would otherwise
  // serve them the previous person's dashboard, cases and notifications until
  // each query happened to go stale on its own.
  useEffect(
    () =>
      useAuthStore.subscribe((state, previous) => {
        if (state.user?.id !== previous.user?.id) queryClient.clear();
        // Whoever signs in next starts from the default until their own
        // preference loads, rather than from the previous person's choice.
        if (!state.user && previous.user) setTheme(DEFAULT_THEME);
      }),
    [queryClient],
  );

  // Raised by the API client when a refresh finally fails; one listener keeps
  // every open query from trying to handle the logout separately.
  useEffect(() => {
    const onUnauthenticated = () => clearSession();
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [clearSession]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Public: the browser lands here from the provider with no session yet. */}
      <Route path="/auth/sso/callback" element={<SsoCallbackPage />} />

      <Route
        path="/change-password"
        element={
          <RequireAuth allowPendingPasswordChange>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/cases"
          element={
            <RequireAuth permission={Permission.CASE_READ}>
              <CasesListPage />
            </RequireAuth>
          }
        />
        <Route
          path="/cases/new"
          element={
            <RequireAuth permission={Permission.CASE_CREATE}>
              <NewCasePage />
            </RequireAuth>
          }
        />
        <Route
          path="/cases/:id"
          element={
            <RequireAuth permission={Permission.CASE_READ}>
              <CaseWorkspacePage />
            </RequireAuth>
          }
        />
        <Route
          path="/alerts"
          element={
            <RequireAuth permission={Permission.ALERT_READ}>
              <AlertsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/api-keys"
          element={
            <RequireAuth permission={Permission.API_KEY_MANAGE}>
              <ApiKeysPage />
            </RequireAuth>
          }
        />
        <Route
          path="/observables"
          element={
            <RequireAuth permission={Permission.CASE_READ}>
              <ObservablesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/whitelist"
          element={
            <RequireAuth permission={Permission.TAXONOMY_MANAGE}>
              <WhitelistPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/lookups"
          element={
            <RequireAuth permission={Permission.SETTINGS_MANAGE}>
              <LookupProvidersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/domain"
          element={
            <RequireAuth permission={Permission.SETTINGS_MANAGE}>
              <IdentityDomainPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/sso"
          element={
            <RequireAuth permission={Permission.SETTINGS_MANAGE}>
              <SsoSettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAuth permission={Permission.USER_MANAGE}>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/users/import"
          element={
            <RequireAuth permission={Permission.USER_MANAGE}>
              <UserImportPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/playbooks"
          element={
            <RequireAuth permission={Permission.TAXONOMY_MANAGE}>
              <PlaybooksPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequireAuth permission={Permission.AUDIT_READ}>
              <AuditLogPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <RequireAuth permission={Permission.SETTINGS_MANAGE}>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/system"
          element={
            <RequireAuth permission={Permission.SETTINGS_MANAGE}>
              <SystemPage />
            </RequireAuth>
          }
        />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
