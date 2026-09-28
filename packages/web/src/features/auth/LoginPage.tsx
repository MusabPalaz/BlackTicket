import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, BASE_URL } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { AuthLayout } from '@/app/layout/AuthLayout';
import { Alert, Button, Field, Input } from '@/components/ui';

interface SsoStatus {
  enabled: boolean;
  buttonLabel: string;
  /** False once the product is in SSO mode: only break-glass gets through. */
  localSignInAllowed: boolean;
}

interface LoginState {
  from?: string;
  passwordChanged?: boolean;
}

/**
 * Sign-in.
 *
 * The second factor is a second step rather than a third field: the server only
 * reveals that TOTP is required once the password is correct, so asking for a
 * code up front would leak which accounts have 2FA enabled.
 */
export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LoginState | null) ?? {};

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const [showLocal, setShowLocal] = useState(false);

  /*
   * Unauthenticated on purpose: the screen has to render before anyone has a
   * session. A failure here is not fatal — the local form is the fallback.
   */
  const sso = useQuery({
    queryKey: ['sso-status'],
    queryFn: () => api.get<SsoStatus>('/auth/sso/status'),
    retry: false,
    staleTime: 60_000,
  });

  const ssoEnabled = sso.data?.enabled ?? false;
  const localAllowed = sso.data?.localSignInAllowed ?? true;
  /** Under SSO the local form is break-glass, so it does not present itself first. */
  const localCollapsed = ssoEnabled && !localAllowed && !showLocal;
  const ssoError = params.get('ssoError');

  if (user) {
    return (
      <Navigate to={user.mustChangePassword ? '/change-password' : (state.from ?? '/')} replace />
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const account = await login(username, password, needsTotp ? totpCode : undefined);
      navigate(account.mustChangePassword ? '/change-password' : '/', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setError(null);
      } else if (caught instanceof ApiError) {
        setError(caught.detail);
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={needsTotp ? 'Two-factor verification' : 'Sign in'}
      description={
        needsTotp
          ? 'Your password was accepted. One more step.'
          : 'Use your organisation account to continue.'
      }
      footer="Sessions expire after inactivity and every sign-in is written to the audit trail."
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {state.passwordChanged && !needsTotp && (
          <Alert tone="success">Password changed. Sign in with the new one.</Alert>
        )}

        {ssoError && !needsTotp && <Alert>{ssoError}</Alert>}
        {error && <Alert>{error}</Alert>}

        {ssoEnabled && !needsTotp && (
          <div className="space-y-3">
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                // A browser navigation, not a fetch: the API answers with a
                // redirect on to the identity provider.
                const target = state.from ? `?returnTo=${encodeURIComponent(state.from)}` : '';
                window.location.href = `${BASE_URL}/auth/sso/start${target}`;
              }}
            >
              {sso.data?.buttonLabel ?? 'Sign in with your organisation account'}
            </Button>

            {localCollapsed && (
              <button
                type="button"
                onClick={() => setShowLocal(true)}
                className="w-full text-xs text-[var(--color-content-muted)] underline hover:text-[var(--color-content)]"
              >
                Break-glass sign-in
              </button>
            )}

            {!localCollapsed && (
              <div className="flex items-center gap-3 text-xs text-[var(--color-content-faint)]">
                <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
                <span>or</span>
                <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
              </div>
            )}
          </div>
        )}

        {!needsTotp && !localCollapsed ? (
          <>
            {ssoEnabled && !localAllowed && (
              <Alert tone="warning">
                Single sign-on is required. Only the break-glass account can sign in here.
              </Alert>
            )}

            <Field label="Username">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
          </>
        ) : (
          <>
            <Alert tone="info">
              Enter the 6-digit code from your authenticator app, or one recovery code.
            </Alert>
            <Field label="Two-factor code">
              <Input
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                className="font-mono tracking-widest"
              />
            </Field>
          </>
        )}

        {(!localCollapsed || needsTotp) && (
          <Button type="submit" loading={busy} className="w-full">
            {needsTotp ? 'Verify' : 'Sign in'}
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
