import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui';
import {
  OutboundMailDocsCard,
  OutboundMailSettingsCard,
  OutboundMailStatusCard,
} from './OutboundMailCards';

interface DomainPolicyView {
  domain: string | null;
  locked: boolean;
  updatedAt: string | null;
  updatedById: string | null;
  mismatchedUsers: number;
  totalUsers: number;
}

const ENDPOINT = '/admin/settings/identity-domain';

/**
 * Organisation e-mail domain.
 *
 * Setting it is reversible; locking it is the point of the screen — from then
 * on every account, including every row of a CSV import, must sit inside the
 * domain. Unlocking asks for the administrator's password because it removes
 * that guarantee.
 */
export function IdentityDomainPage() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ['identity-domain'],
    queryFn: () => api.get<DomainPolicyView>(ENDPOINT),
  });

  const [domain, setDomain] = useState('');
  const [confirmDomain, setConfirmDomain] = useState('');
  const [lockConfirm, setLockConfirm] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockReason, setUnlockReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSettled(message: string) {
    setError(null);
    setNotice(message);
    void queryClient.invalidateQueries({ queryKey: ['identity-domain'] });
  }

  function onFailed(caught: unknown) {
    setNotice(null);
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const setDomainMutation = useMutation({
    mutationFn: () => api.put<DomainPolicyView>(ENDPOINT, { domain, confirmDomain }),
    onSuccess: () => {
      setDomain('');
      setConfirmDomain('');
      onSettled('Domain saved. It is not enforced until you lock it.');
    },
    onError: onFailed,
  });

  const lockMutation = useMutation({
    mutationFn: (acknowledgeMismatch: boolean) =>
      api.post<DomainPolicyView>(`${ENDPOINT}/lock`, {
        confirmDomain: lockConfirm,
        acknowledgeMismatch,
      }),
    onSuccess: () => {
      setLockConfirm('');
      onSettled('Domain locked. New accounts must use it.');
    },
    onError: onFailed,
  });

  const unlockMutation = useMutation({
    mutationFn: () =>
      api.post<DomainPolicyView>(`${ENDPOINT}/unlock`, {
        password: unlockPassword,
        reason: unlockReason,
      }),
    onSuccess: () => {
      setUnlockPassword('');
      setUnlockReason('');
      onSettled('Domain unlocked. The change is recorded in the audit log.');
    },
    onError: onFailed,
  });

  if (policy.isLoading) {
    return <div className="p-8 text-sm text-[var(--color-content-muted)]">Loading…</div>;
  }

  if (policy.isError || !policy.data) {
    return (
      <div className="p-8">
        <Alert>Could not load the domain policy.</Alert>
      </div>
    );
  }

  const current = policy.data;

  return (
    <div className="max-w-6xl space-y-5 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Organisation domain</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Every account address must belong to this domain once it is locked.
        </p>
      </header>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {/* Controls on the left, their reference on the right — the same
          arrangement the system settings and single sign-on screens use. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-5">
          {/* The mail sender has to live inside this domain, so its status
              belongs next to the policy that decides what the domain is. */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Current policy">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--color-content-muted)]">Domain</dt>
                  <dd className="font-mono">
                    {current.domain ? `@${current.domain}` : 'not configured'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--color-content-muted)]">Status</dt>
                  <dd>
                    {current.locked ? (
                      <Badge tone="good">Locked</Badge>
                    ) : (
                      <Badge tone="warn">Unlocked</Badge>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--color-content-muted)]">Accounts</dt>
                  <dd>
                    {current.totalUsers} total
                    {current.mismatchedUsers > 0 && (
                      <span className="ml-2 text-[var(--color-severity-medium)]">
                        {current.mismatchedUsers} outside the domain
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
            <OutboundMailStatusCard />
          </div>

          {!current.locked && (
            <Card title={current.domain ? 'Change domain' : 'Set domain'}>
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  setDomainMutation.mutate();
                }}
                className="space-y-4"
              >
                <Field label="Domain" hint="Just the domain — for example blackticket.local">
                  <Input
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    placeholder="blackticket.local"
                    className="font-mono"
                    required
                  />
                </Field>
                <Field label="Repeat domain">
                  <Input
                    value={confirmDomain}
                    onChange={(event) => setConfirmDomain(event.target.value)}
                    className="font-mono"
                    required
                  />
                </Field>
                <Button type="submit" loading={setDomainMutation.isPending}>
                  Save domain
                </Button>
              </form>
            </Card>
          )}

          {!current.locked && current.domain && (
            <Card title="Lock domain">
              <p className="mb-4 text-sm text-[var(--color-content-muted)]">
                Locking makes <span className="font-mono">@{current.domain}</span> mandatory for
                every account created from now on. Unlocking later requires your password and is
                written to the audit log.
              </p>
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  lockMutation.mutate(current.mismatchedUsers > 0);
                }}
                className="space-y-4"
              >
                <Field label="Retype the domain to confirm">
                  <Input
                    value={lockConfirm}
                    onChange={(event) => setLockConfirm(event.target.value)}
                    className="font-mono"
                    required
                  />
                </Field>
                {current.mismatchedUsers > 0 && (
                  <Alert tone="warning">
                    {current.mismatchedUsers} existing account(s) sit outside this domain. They keep
                    working; only new accounts are affected.
                  </Alert>
                )}
                <Button type="submit" loading={lockMutation.isPending}>
                  Lock domain
                </Button>
              </form>
            </Card>
          )}

          {current.locked && (
            <Card title="Unlock domain">
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  unlockMutation.mutate();
                }}
                className="space-y-4"
              >
                <Field label="Your password">
                  <Input
                    type="password"
                    value={unlockPassword}
                    onChange={(event) => setUnlockPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <Field label="Reason" hint="Stored in the audit trail">
                  <Input
                    value={unlockReason}
                    onChange={(event) => setUnlockReason(event.target.value)}
                    placeholder="Migrating to a new mail domain"
                    required
                  />
                </Field>
                <Button type="submit" variant="danger" loading={unlockMutation.isPending}>
                  Unlock
                </Button>
              </form>
            </Card>
          )}
          <OutboundMailSettingsCard />
        </div>

        <div className="space-y-5">
          <OutboundMailDocsCard />
        </div>
      </div>
    </div>
  );
}
