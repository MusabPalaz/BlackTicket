import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';

/**
 * Own account: password and second factor.
 *
 * The secret is rendered as a QR locally — the seed never leaves the page for
 * a third-party image service, which is the usual way this goes wrong.
 */
export function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const clearSession = useAuthStore((state) => state.clearSession);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<{ secret: string; uri: string; qr: string } | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');

  function fail(caught: unknown) {
    setNotice(null);
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const startSetup = useMutation({
    mutationFn: async () => {
      const result = await api.post<{ secret: string; uri: string }>('/auth/totp/setup', {});
      const qr = await QRCode.toDataURL(result.uri, { margin: 1, width: 200 });
      return { ...result, qr };
    },
    onSuccess: (result) => {
      setError(null);
      setEnrolment(result);
    },
    onError: fail,
  });

  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/totp/enable', { code }),
    onSuccess: async (result) => {
      setError(null);
      setEnrolment(null);
      setCode('');
      setRecoveryCodes(result.recoveryCodes);
      setNotice('Two-factor authentication is on.');
      await refreshUser();
    },
    onError: fail,
  });

  const disable = useMutation({
    mutationFn: () => api.post('/auth/totp/disable', { password: disablePassword }),
    onSuccess: async () => {
      setError(null);
      setDisablePassword('');
      setNotice('Two-factor authentication is off.');
      await refreshUser();
    },
    onError: fail,
  });

  const signOutEverywhere = useMutation({
    mutationFn: () => api.post('/auth/logout', {}),
    onSuccess: () => clearSession(),
  });

  return (
    <div className="max-w-2xl space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {user?.fullName} · {user?.username} · {user?.role}
        </p>
      </header>

      {/*
       * Stays until the second factor is on. Not a dismissible toast: an
       * account without it is a standing weakness, not an event that happened
       * once, and a SOC tool is exactly the sort of thing worth a second
       * factor.
       */}
      {user && !user.totpEnabled && (
        <Alert tone="warning">
          <p className="font-medium">Two-factor authentication is off.</p>
          <p className="mt-0.5">
            Your password is the only thing standing between this account and whoever else has it.{' '}
            <a href="#two-factor" className="underline hover:text-[var(--color-content)]">
              Set it up below
            </a>
            .
          </p>
        </Alert>
      )}

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card title="Details">
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-content-muted)]">E-mail</dt>
            <dd className="font-mono text-xs">{user?.email}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-content-muted)]">Last sign-in</dt>
            <dd className="text-xs">{formatDateTime(user?.lastLoginAt ?? null)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-content-muted)]">Two-factor</dt>
            <dd>
              {user?.totpEnabled ? (
                <Badge tone="good">enabled</Badge>
              ) : (
                <Badge tone="warn">off</Badge>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {recoveryCodes && (
        <Alert tone="warning">
          <p className="font-medium">Save these recovery codes now — each works once.</p>
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
            {recoveryCodes.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
          <button className="mt-2 text-xs underline" onClick={() => setRecoveryCodes(null)}>
            I have saved them
          </button>
        </Alert>
      )}

      <Card title="Two-factor authentication" id="two-factor">
        {user?.totpEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-content-muted)]">
              Turning this off lowers the protection on your account, so it asks for your password.
            </p>
            <Field label="Password">
              <Input
                type="password"
                value={disablePassword}
                onChange={(event) => setDisablePassword(event.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Button
              variant="danger"
              disabled={!disablePassword}
              loading={disable.isPending}
              onClick={() => disable.mutate()}
            >
              Turn off
            </Button>
          </div>
        ) : enrolment ? (
          <div className="space-y-3">
            <p className="text-sm">
              Scan this with your authenticator app, then enter the code it shows.
            </p>
            <img
              src={enrolment.qr}
              alt="Two-factor setup QR code"
              className="rounded bg-white p-2"
            />
            <p className="text-xs text-[var(--color-content-muted)]">
              Cannot scan? Enter this key manually:{' '}
              <code className="font-mono">{enrolment.secret}</code>
            </p>
            <Field label="Code from the app">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                className="w-40 font-mono tracking-widest"
              />
            </Field>
            <div className="flex gap-2">
              <Button
                loading={enable.isPending}
                disabled={code.length !== 6}
                onClick={() => enable.mutate()}
              >
                Confirm
              </Button>
              <Button variant="secondary" onClick={() => setEnrolment(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-content-muted)]">
              A second factor stops a stolen password from being enough.
            </p>
            <Button loading={startSetup.isPending} onClick={() => startSetup.mutate()}>
              Set up
            </Button>
          </div>
        )}
      </Card>

      <Card title="Sessions">
        <p className="text-sm text-[var(--color-content-muted)]">
          Signing out here ends this session. Changing your password ends all of them.
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => signOutEverywhere.mutate()}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
