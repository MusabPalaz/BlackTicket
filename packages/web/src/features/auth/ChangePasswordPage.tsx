import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { AuthLayout } from '@/app/layout/AuthLayout';
import { Alert, Button, Field, Input } from '@/components/ui';

/**
 * Serves both the forced rotation after a bootstrap or admin-reset password and
 * a voluntary change. Because the server revokes every other session on
 * success, the user is signed out and has to authenticate with the new secret.
 */
export function ChangePasswordPage() {
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const forced = user?.mustChangePassword ?? false;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      clearSession();
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Change Password"
      description={
        forced
          ? 'This account still uses a temporary password. Choose a new one to continue.'
          : 'Pick a new password for your account.'
      }
      footer="All other sessions are signed out when the password changes."
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {forced && (
          <Alert tone="warning">Nothing else in the product is available until this is done.</Alert>
        )}

        <Field label="Current password">
          <Input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        </Field>

        <Field
          label="New password"
          hint="At least 12 characters. Unrelated words work better than symbol soup."
        >
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Field label="Repeat new password">
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" loading={busy} className="w-full">
          Change password
        </Button>
      </form>
    </AuthLayout>
  );
}
