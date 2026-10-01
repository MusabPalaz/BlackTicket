import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { AuthLayout } from '@/app/layout/AuthLayout';
import { Alert, Button, Spinner } from '@/components/ui';

/**
 * Landing point after the identity provider.
 *
 * The URL carries a single-use handoff code, never a token. It is traded
 * immediately and then stripped from the address bar, so nothing usable is
 * left behind in browser history or in a copied link.
 */
export function SsoCallbackPage() {
  const completeSso = useAuthStore((state) => state.completeSso);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const code = params.get('code');
  const returnTo = params.get('returnTo');

  /* The mutation carries the failure, so the effect never sets state itself. */
  const exchange = useMutation({
    mutationFn: (handoff: string) => completeSso(handoff),
    onSuccess: (result) => {
      // Drop the code from the address bar before anything can copy or bookmark it.
      window.history.replaceState({}, '', '/');
      navigate(
        result.user.mustChangePassword ? '/change-password' : (result.returnTo ?? returnTo ?? '/'),
        { replace: true },
      );
    },
  });

  /*
   * React runs effects twice in StrictMode, and the code is spent on first use,
   * so a second attempt would fail against a code this very page just consumed.
   */
  const started = useRef(false);
  const { mutate } = exchange;

  useEffect(() => {
    if (started.current || !code) return;
    started.current = true;
    mutate(code);
  }, [code, mutate]);

  const error = !code
    ? 'The sign-in link is missing its code. Start again.'
    : exchange.isError
      ? exchange.error instanceof ApiError
        ? exchange.error.detail
        : 'Could not reach the server. Try again.'
      : null;

  return (
    <AuthLayout
      title={error ? 'Sign-In Failed' : 'Signing You In'}
      description={
        error ? 'The identity provider answered, but the session could not be created.' : undefined
      }
      footer="Every sign-in is written to the audit trail."
    >
      {error ? (
        <div className="space-y-4">
          <Alert>{error}</Alert>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-[var(--color-content-muted)]">
          <Spinner className="h-4 w-4" />
          <span>Completing sign-in…</span>
        </div>
      )}
    </AuthLayout>
  );
}
