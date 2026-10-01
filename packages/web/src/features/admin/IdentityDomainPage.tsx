import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDomainList } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  OutboundMailDocsCard,
  OutboundMailSettingsCard,
  OutboundMailStatusCard,
} from './OutboundMailCards';

interface DomainPolicyView {
  domain: string | null;
  additionalDomains: string[];
  locked: boolean;
  updatedAt: string | null;
  updatedById: string | null;
  mismatchedUsers: number;
  totalUsers: number;
}

const ENDPOINT = '/admin/settings/identity-domain';

/**
 * Organisation e-mail domains: a primary one plus any others the organisation
 * mails from (one directory tenant often serves several).
 *
 * They apply as soon as they are saved: every account, including every row of a
 * CSV import and every single sign-on, must sit inside one of the domains.
 * Locking freezes the list so it cannot be changed through the normal form;
 * unlocking asks for the administrator's password because it lifts that.
 */
export function IdentityDomainPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const policy = useQuery({
    queryKey: ['identity-domain'],
    queryFn: () => api.get<DomainPolicyView>(ENDPOINT),
  });

  const [domain, setDomain] = useState('');
  const [confirmDomain, setConfirmDomain] = useState('');
  const [extraDomain, setExtraDomain] = useState('');
  const [confirmExtraDomain, setConfirmExtraDomain] = useState('');
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
      onSettled('Domain saved. New accounts must use an organisation domain from now on.');
    },
    onError: onFailed,
  });

  const addDomainMutation = useMutation({
    mutationFn: () =>
      api.post<DomainPolicyView>(`${ENDPOINT}/domains`, {
        domain: extraDomain,
        confirmDomain: confirmExtraDomain,
      }),
    onSuccess: (view) => {
      setExtraDomain('');
      setConfirmExtraDomain('');
      onSettled(`Added @${view.additionalDomains[view.additionalDomains.length - 1]}.`);
    },
    onError: onFailed,
  });

  const removeDomainMutation = useMutation({
    mutationFn: (domain: string) =>
      api.delete<DomainPolicyView>(`${ENDPOINT}/domains/${encodeURIComponent(domain)}`),
    onSuccess: (_view, domain) => onSettled(`Removed @${domain}.`),
    onError: onFailed,
  });

  // Lock and unlock run from their dialogs, which show a failure themselves and
  // stay open — a mistyped password should not mean starting over.
  const lockMutation = useMutation({
    mutationFn: (body: { confirmDomain: string; acknowledgeMismatch: boolean }) =>
      api.post<DomainPolicyView>(`${ENDPOINT}/lock`, body),
    onSuccess: () => onSettled('Domains locked. Changing them now requires your password.'),
  });

  const unlockMutation = useMutation({
    mutationFn: (body: { password: string; reason: string }) =>
      api.post<DomainPolicyView>(`${ENDPOINT}/unlock`, body),
    onSuccess: () => onSettled('Domain unlocked. The change is recorded in the audit log.'),
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
  const allDomains = current.domain ? [current.domain, ...current.additionalDomains] : [];

  return (
    <div className="max-w-6xl space-y-5 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Organisation Domain</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Every account address must belong to one of these domains. Lock them so the list cannot be
          changed without your password.
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
            <Card title="Current Policy">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--color-content-muted)]">Primary domain</dt>
                  <dd className="font-mono">
                    {current.domain ? `@${current.domain}` : 'not configured'}
                  </dd>
                </div>
                {current.domain && (
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--color-content-muted)]">Additional domains</dt>
                    <dd>{current.additionalDomains.length || 'none'}</dd>
                  </div>
                )}
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
                        {current.mismatchedUsers} outside the domains
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
            <OutboundMailStatusCard />
          </div>

          {!current.locked && (
            <Card title={current.domain ? 'Change Primary Domain' : 'Set Domain'}>
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

          {current.domain && (
            <Card
              title="Additional Domains"
              description="Other mail domains of the same organisation, for example several domains in one Entra tenant."
            >
              <p className="mb-4 text-sm text-[var(--color-content-muted)]">
                Accounts, CSV imports, SCIM and single sign-on accept every domain listed here
                exactly as they accept the primary one. Addresses derived from a bare username
                always use <span className="font-mono">@{current.domain}</span>.
              </p>
              {current.additionalDomains.length > 0 ? (
                <ul className="mb-4 divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
                  {current.additionalDomains.map((extra) => (
                    <li key={extra} className="flex items-center justify-between px-3 py-2">
                      <span className="font-mono text-sm">@{extra}</span>
                      {!current.locked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          loading={
                            removeDomainMutation.isPending &&
                            removeDomainMutation.variables === extra
                          }
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Remove @${extra}?`,
                              body: (
                                <>
                                  <p>No new account can be created in it.</p>
                                  <p>
                                    Accounts there that sign in with a local password keep working.
                                    Single sign-on checks the domain on every sign-in, so anyone
                                    with an address there is refused — existing accounts included.
                                  </p>
                                </>
                              ),
                              confirmLabel: 'Remove domain',
                            });
                            if (ok) removeDomainMutation.mutate(extra);
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-sm text-[var(--color-content-muted)]">None yet.</p>
              )}
              {current.locked ? (
                <p className="text-sm text-[var(--color-content-muted)]">
                  The domains are locked. Unlock them to add or remove one.
                </p>
              ) : (
                <form
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    addDomainMutation.mutate();
                  }}
                  className="space-y-4"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Domain">
                      <Input
                        value={extraDomain}
                        onChange={(event) => setExtraDomain(event.target.value)}
                        placeholder="subsidiary.example.com"
                        className="font-mono"
                        required
                      />
                    </Field>
                    <Field label="Repeat domain">
                      <Input
                        value={confirmExtraDomain}
                        onChange={(event) => setConfirmExtraDomain(event.target.value)}
                        className="font-mono"
                        required
                      />
                    </Field>
                  </div>
                  <Button type="submit" variant="secondary" loading={addDomainMutation.isPending}>
                    Add domain
                  </Button>
                </form>
              )}
            </Card>
          )}

          {!current.locked && current.domain && (
            <Card title="Lock Domain">
              <p className="mb-4 text-sm text-[var(--color-content-muted)]">
                New accounts already have to use{' '}
                <span className="font-mono">{formatDomainList(allDomains)}</span>. Locking stops
                that list from being changed through this form; unlocking later requires your
                password and is written to the audit log.
              </p>
              {current.mismatchedUsers > 0 && (
                <div className="mb-4">
                  <Alert tone="warning">
                    {current.mismatchedUsers} existing account(s) sit outside these domains. Those
                    signing in with a local password keep working; through single sign-on they are
                    refused.
                  </Alert>
                </div>
              )}
              <Button
                loading={lockMutation.isPending}
                onClick={() => {
                  const primary = current.domain!;
                  void confirm({
                    title: 'Lock the organisation domains?',
                    body: (
                      <p>
                        <span className="font-mono text-[var(--color-content)]">
                          {formatDomainList(allDomains)}
                        </span>{' '}
                        can then only be changed after unlocking, which asks for your password and
                        is written to the audit log.
                      </p>
                    ),
                    confirmLabel: 'Lock domains',
                    tone: 'primary',
                    typeToConfirm: primary,
                    onConfirm: () =>
                      lockMutation.mutateAsync({
                        confirmDomain: primary,
                        // The warning above and the dialog both said it; that is
                        // the acknowledgement the server asks for.
                        acknowledgeMismatch: current.mismatchedUsers > 0,
                      }),
                  });
                }}
              >
                Lock domain…
              </Button>
            </Card>
          )}

          {current.locked && (
            <Card title="Unlock Domain">
              <p className="mb-4 text-sm text-[var(--color-content-muted)]">
                Unlocking lets the domains be changed again. It asks for your password and records a
                reason in the audit log.
              </p>
              <Button
                variant="danger"
                loading={unlockMutation.isPending}
                onClick={() =>
                  void confirm({
                    title: 'Unlock the organisation domains?',
                    body: (
                      <p>
                        Until they are locked again, any administrator can change which domains
                        accounts — and single sign-on — accept.
                      </p>
                    ),
                    confirmLabel: 'Unlock',
                    fields: [
                      {
                        name: 'password',
                        label: 'Your password',
                        kind: 'password',
                        required: true,
                      },
                      {
                        name: 'reason',
                        label: 'Reason',
                        hint: 'Stored in the audit trail',
                        placeholder: 'Migrating to a new mail domain',
                        required: true,
                        maxLength: 500,
                      },
                    ],
                    onConfirm: ({ password, reason }) =>
                      unlockMutation.mutateAsync({
                        password: password ?? '',
                        reason: reason ?? '',
                      }),
                  })
                }
              >
                Unlock…
              </Button>
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
