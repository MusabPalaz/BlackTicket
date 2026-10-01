import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Role } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, cx } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';
import { useConfirm } from '@/components/ConfirmDialog';
import type { AccountDetail, AccountRow, AccountsPage } from './types';

const controlClass =
  'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]';

export function UsersPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const me = useAuthStore((state) => state.user);

  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    username: '',
    fullName: '',
    password: '',
    role: Role.ANALYST as Role,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuedPassword, setIssuedPassword] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkTags, setBulkTags] = useState('');
  const [bulkRole, setBulkRole] = useState<Role | ''>('');
  /** Set while a role change is waiting to be confirmed. */
  /** What a batch actually did, kept until the next one replaces it. */
  const [outcome, setOutcome] = useState<{
    changed: number;
    refused: { who: string; reason: string }[];
  } | null>(null);

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  if (tagFilter.length) params.set('tags', tagFilter.join(','));

  const accounts = useQuery({
    queryKey: ['admin-users', params.toString()],
    queryFn: () => api.get<AccountsPage>(`/admin/users?${params.toString()}`),
  });

  const labels = useQuery({
    queryKey: ['admin-user-tags'],
    queryFn: () => api.get<{ items: { name: string; count: number }[] }>('/admin/users/tags'),
  });

  const detail = useQuery({
    queryKey: ['admin-user', selectedId],
    queryFn: () => api.get<AccountDetail>(`/admin/users/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-user'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-user-tags'] });
  }

  // A selection only means something against the rows it was made on. When the
  // filter changes the list underneath it does too, so it is dropped rather
  // than left pointing at accounts nobody can see any more.
  const [filterAtPick, setFilterAtPick] = useState(params.toString());
  if (filterAtPick !== params.toString()) {
    setFilterAtPick(params.toString());
    setPicked([]);
  }

  const rows = accounts.data?.items ?? [];
  const allPicked = rows.length > 0 && rows.every((row) => picked.includes(row.id));

  function togglePicked(id: string) {
    setOutcome(null);
    setPicked((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleTagFilter(name: string) {
    setTagFilter((current) =>
      current.includes(name) ? current.filter((value) => value !== name) : [...current, name],
    );
  }

  function fail(caught: unknown) {
    setNotice(null);
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  function succeed(message: string) {
    setError(null);
    setNotice(message);
    refresh();
  }

  const createUser = useMutation({
    mutationFn: () => api.post<AccountRow>('/admin/users', form),
    onSuccess: (created) => {
      setForm({ username: '', fullName: '', password: '', role: Role.ANALYST });
      setCreating(false);
      succeed(
        `Created ${created.username} <${created.email}> — must change the password at first sign-in.`,
      );
    },
    onError: fail,
  });

  const action = useMutation({
    mutationFn: async ({
      id,
      path,
      method = 'POST',
    }: {
      id: string;
      path: string;
      method?: 'POST' | 'DELETE';
    }) =>
      method === 'DELETE'
        ? api.delete(`/admin/users/${id}`)
        : api.post(`/admin/users/${id}/${path}`, {}),
    onError: fail,
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) =>
      api.post<{ temporaryPassword: string }>(`/admin/users/${id}/reset-password`, {}),
    onSuccess: (result) => {
      setIssuedPassword(result.temporaryPassword);
      succeed('Temporary password issued. It is shown once.');
    },
    onError: fail,
  });

  const updateUser = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/admin/users/${id}`, patch),
    onSuccess: () => succeed('Account updated.'),
    onError: fail,
  });

  const bulk = useMutation({
    mutationFn: (body: { action: string; tags?: string[]; role?: Role }) =>
      api.post<{ changed: number; skipped: { id: string; reason: string }[] }>(
        '/admin/users/bulk',
        {
          userIds: picked,
          ...body,
        },
      ),
    onSuccess: (result) => {
      // Resolved before the list refetches, while the names are still on screen.
      const nameOf = (id: string) => rows.find((row) => row.id === id)?.username ?? id.slice(0, 8);

      setPicked([]);
      setBulkTags('');
      setBulkRole('');
      setOutcome({
        changed: result.changed,
        refused: result.skipped.map((entry) => ({
          who: nameOf(entry.id),
          reason: entry.reason,
        })),
      });
      setError(null);
      setNotice(null);
      refresh();
    },
    onError: fail,
  });

  /*
   * A label that has just been taken off the last account still has to be
   * offered, or the filter using it becomes invisible while it is still
   * applied — an empty list with nothing to clear.
   */
  const shownLabels = [
    ...(labels.data?.items ?? []),
    ...tagFilter
      .filter((name) => !(labels.data?.items ?? []).some((label) => label.name === name))
      .map((name) => ({ name, count: 0 })),
  ];

  const bulkTagList = bulkTags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const selected = detail.data;

  return (
    <div className="space-y-4 p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {accounts.data ? `${accounts.data.total} account(s)` : 'Loading…'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/users/import">
            <Button variant="secondary">Import from CSV</Button>
          </Link>
          <Button onClick={() => setCreating((value) => !value)}>
            {creating ? 'Cancel' : 'New account'}
          </Button>
        </div>
      </header>

      {/*
       * Believing there is a way back in when there is not is worse than
       * knowing there is none, so the absence is stated rather than left to
       * be noticed.
       */}
      {accounts.data && !accounts.data.hasRecoveryAccount && (
        <Alert tone="warning">
          No recovery account exists. Nothing here is protected from being deleted, disabled or
          demoted, so a mistake on this screen can leave the system without a usable administrator.
          Set <span className="font-mono">SEED_RECOVERY_PASSWORD</span> in the environment and run{' '}
          <span className="font-mono">npm run db:seed</span> to create one.
        </Alert>
      )}

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {/*
       * Every refusal, named and with its own reason. The earlier version
       * showed the first one and a count, which quietly implied the rest had
       * failed for the same cause — the one thing a batch report must not do.
       */}
      {outcome && (
        <Alert
          tone={outcome.refused.length === 0 ? 'success' : 'warning'}
          onDismiss={() => setOutcome(null)}
        >
          <p>
            {outcome.changed} account(s) changed
            {outcome.refused.length > 0 && `, ${outcome.refused.length} left alone`}.
          </p>
          {outcome.refused.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {outcome.refused.slice(0, 8).map((entry) => (
                <li key={entry.who} className="text-xs">
                  <span className="font-mono">{entry.who}</span> — {entry.reason}
                </li>
              ))}
              {outcome.refused.length > 8 && (
                <li className="text-xs opacity-70">…and {outcome.refused.length - 8} more</li>
              )}
            </ul>
          )}
        </Alert>
      )}
      {issuedPassword && (
        <Alert tone="warning">
          <p className="font-medium">
            Temporary password — copy it now, it is not stored in readable form.
          </p>
          <code className="mt-2 block font-mono text-sm">{issuedPassword}</code>
          <button className="mt-2 text-xs underline" onClick={() => setIssuedPassword(null)}>
            Done
          </button>
        </Alert>
      )}

      {creating && (
        <Card title="Create account">
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              createUser.mutate();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field label="Username" hint="The address is derived from the organisation domain">
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </Field>
            <Field label="Full name">
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                required
              />
            </Field>
            <Field label="Initial password" hint="At least 12 characters; the user must change it">
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Role">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className={cx(controlClass, 'w-full')}
              >
                {Object.values(Role).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={createUser.isPending}>
                Create account
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search username, e-mail or name…"
            className="min-w-64 flex-1"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={controlClass}
          >
            <option value="">Any role</option>
            {Object.values(Role).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={controlClass}
          >
            <option value="">Any status</option>
            {['ACTIVE', 'DISABLED', 'LOCKED', 'PENDING_ACTIVATION'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        {shownLabels.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border-subtle)] pt-3">
            <span className="mr-1 text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
              Labels
            </span>
            {shownLabels.map((label) => {
              const on = tagFilter.includes(label.name);
              return (
                <button
                  key={label.name}
                  onClick={() => toggleTagFilter(label.name)}
                  aria-pressed={on}
                  className={cx(
                    'rounded border px-2 py-0.5 text-xs transition-colors',
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border-subtle)] text-[var(--color-content-muted)] hover:border-[var(--color-border-strong)]',
                  )}
                >
                  {label.name}
                  <span className="ml-1.5 opacity-60">{label.count}</span>
                </button>
              );
            })}
            {tagFilter.length > 0 && (
              <button
                onClick={() => setTagFilter([])}
                className="ml-1 text-xs text-[var(--color-content-muted)] underline hover:text-[var(--color-content)]"
              >
                clear
              </button>
            )}
          </div>
        )}
      </Card>

      {picked.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{picked.length} selected</span>

            <Input
              value={bulkTags}
              onChange={(event) => setBulkTags(event.target.value)}
              placeholder="shift-a, tier-1"
              className="min-w-48 flex-1"
            />
            <Button
              variant="secondary"
              disabled={bulkTagList.length === 0}
              loading={bulk.isPending}
              onClick={() => bulk.mutate({ action: 'addTags', tags: bulkTagList })}
            >
              Add labels
            </Button>
            <Button
              variant="secondary"
              disabled={bulkTagList.length === 0}
              onClick={() => bulk.mutate({ action: 'removeTags', tags: bulkTagList })}
            >
              Remove labels
            </Button>

            <span className="mx-1 h-5 w-px bg-[var(--color-border-subtle)]" />

            <select
              value={bulkRole}
              onChange={(event) => setBulkRole(event.target.value as Role | '')}
              className={controlClass}
              aria-label="Role to apply"
            >
              <option value="">Change role…</option>
              {Object.values(Role).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={!bulkRole}
              onClick={async () => {
                // A role decides what an account may do, so it does not move on
                // one click: the dialog spells out the count, the target and the
                // parts that are easy to forget.
                const role = bulkRole as Role;
                const ok = await confirm({
                  title: `Change ${picked.length} account(s) to ${role}?`,
                  body: (
                    <p>
                      Every signed-in session of those accounts ends immediately. Your own account
                      and the last administrator are left alone.
                    </p>
                  ),
                  confirmLabel: 'Change the role',
                  tone: 'primary',
                });
                if (ok) bulk.mutate({ action: 'setRole', role });
              }}
            >
              Change role
            </Button>

            <span className="mx-1 h-5 w-px bg-[var(--color-border-subtle)]" />

            <Button variant="secondary" onClick={() => bulk.mutate({ action: 'enable' })}>
              Enable
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await confirm({
                  title: `Disable ${picked.length} account(s)?`,
                  body: (
                    <p>
                      They can no longer sign in, and every session they have open ends now. Your
                      own account, the recovery account and the last administrator are skipped.
                    </p>
                  ),
                  confirmLabel: `Disable ${picked.length}`,
                });
                if (ok) bulk.mutate({ action: 'disable' });
              }}
            >
              Disable
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await confirm({
                  title: `Sign out ${picked.length} account(s)?`,
                  body: (
                    <p>Every session they have open ends now; they can sign straight back in.</p>
                  ),
                  confirmLabel: 'Sign them out',
                });
                if (ok) bulk.mutate({ action: 'forceLogout' });
              }}
            >
              Sign out
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${picked.length} account(s)?`,
                  body: (
                    <>
                      <p>
                        They are removed from the console and can no longer sign in. This cannot be
                        undone here; disabling is the reversible alternative.
                      </p>
                      <p>
                        Accounts still holding open cases are refused, and so is the recovery
                        account.
                      </p>
                    </>
                  ),
                  confirmLabel: `Delete ${picked.length} account(s)`,
                  typeToConfirm: String(picked.length),
                });
                if (ok) bulk.mutate({ action: 'delete' });
              }}
            >
              Delete…
            </Button>

            <button
              onClick={() => setPicked([])}
              className="ml-auto text-xs text-[var(--color-content-muted)] underline hover:text-[var(--color-content)]"
            >
              clear selection
            </button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          {/* An empty table under an error message reads as "no accounts",
              which is exactly the wrong conclusion. */}
          {accounts.isError ? (
            <ErrorState onRetry={() => void accounts.refetch()} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[var(--color-content-muted)] uppercase">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">
                      <input
                        type="checkbox"
                        checked={allPicked}
                        aria-label="Select every account on this page"
                        onChange={() => setPicked(allPicked ? [] : rows.map((row) => row.id))}
                      />
                    </th>
                    <th className="pb-2 pr-3 font-medium">Account</th>
                    <th className="pb-2 pr-3 font-medium">Role</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Labels</th>
                    <th className="pb-2 font-medium">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.data?.items.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      className={cx(
                        'cursor-pointer border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-overlay)]',
                        selectedId === row.id && 'bg-[var(--color-surface-overlay)]',
                      )}
                    >
                      {/* The checkbox is a separate target: ticking a row must
                          not also open it in the panel. */}
                      <td className="py-2 pr-3" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={picked.includes(row.id)}
                          aria-label={`Select ${row.username}`}
                          onChange={() => togglePicked(row.id)}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <span className="block">{row.fullName}</span>
                        <span className="font-mono text-xs text-[var(--color-content-muted)]">
                          {row.email}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">{row.role}</td>
                      <td className="py-2 pr-3">
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={row.status === 'ACTIVE' ? 'good' : 'warn'}>
                            {row.status}
                          </Badge>
                          {row.mustChangePassword && <Badge tone="warn">password pending</Badge>}
                          {row.totpEnabled && <Badge tone="good">2FA</Badge>}
                          {row.isRecoveryAccount && <Badge tone="accent">recovery</Badge>}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="flex flex-wrap gap-1">
                          {row.tags.length === 0 ? (
                            <span className="text-xs text-[var(--color-content-faint)]">—</span>
                          ) : (
                            row.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                          )}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-[var(--color-content-muted)]">
                        {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selected ? (
          <Card title={selected.user.fullName}>
            <dl className="space-y-2 text-sm">
              <Row label="Username">{selected.user.username}</Row>
              <Row label="E-mail">
                <span className="font-mono text-xs">{selected.user.email}</span>
              </Row>
              <Row label="Role">
                <select
                  value={selected.user.role}
                  disabled={selected.user.id === me?.id}
                  onChange={async (event) => {
                    // The select is controlled, so a cancelled change snaps back by itself.
                    const role = event.target.value;
                    const ok = await confirm({
                      title: `Make ${selected.user.username} ${role}?`,
                      body: (
                        <p>
                          From {selected.user.role} to {role}. What the account may see and do
                          changes at once, and every session it has open ends.
                        </p>
                      ),
                      confirmLabel: 'Change role',
                      tone: 'primary',
                    });
                    if (ok) updateUser.mutate({ id: selected.user.id, patch: { role } });
                  }}
                  className={cx(controlClass, 'text-xs')}
                >
                  {Object.values(Role).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Status">{selected.user.status}</Row>
              <Row label="Labels">
                {/* Committed on Enter or on leaving the field rather than per
                    keystroke: a comma-separated list is only meaningful once
                    the typing stops. */}
                <Input
                  defaultValue={selected.user.tags.join(', ')}
                  key={`${selected.user.id}:${selected.user.tags.join(',')}`}
                  placeholder="shift-a, tier-1"
                  className="py-1 text-xs"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  onBlur={(event) => {
                    const next = event.target.value
                      .split(',')
                      .map((tag) => tag.trim().toLowerCase())
                      .filter(Boolean);
                    const current = selected.user.tags;
                    const same =
                      next.length === current.length && next.every((tag) => current.includes(tag));
                    if (!same) {
                      updateUser.mutate({ id: selected.user.id, patch: { tags: next } });
                    }
                  }}
                />
              </Row>
              <Row label="Active sessions">{selected.activeSessions}</Row>
              <Row label="Failed sign-ins">{selected.failedLoginCount}</Row>
              <Row label="Last IP">
                <span className="font-mono text-xs">{selected.lastLoginIp ?? '—'}</span>
              </Row>
              <Row label="Open cases">
                {Object.entries(selected.assignedCases)
                  .filter(([key]) => key !== 'CLOSED' && key !== 'RESOLVED')
                  .reduce((total, [, value]) => total + value, 0)}
              </Row>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border-subtle)] pt-4">
              {selected.user.status === 'ACTIVE' ? (
                <Button
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  disabled={selected.user.id === me?.id}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Disable ${selected.user.username}?`,
                      body: (
                        <p>
                          The account can no longer sign in, and every session it has open ends now.
                          Its cases and history stay; you can enable it again later.
                        </p>
                      ),
                      confirmLabel: 'Disable account',
                    });
                    if (!ok) return;
                    action.mutate(
                      { id: selected.user.id, path: 'disable' },
                      { onSuccess: () => succeed('Account disabled.') },
                    );
                  }}
                >
                  Disable
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() =>
                    action.mutate(
                      { id: selected.user.id, path: 'enable' },
                      { onSuccess: () => succeed('Account enabled.') },
                    )
                  }
                >
                  Enable
                </Button>
              )}

              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                loading={resetPassword.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Reset the password of ${selected.user.username}?`,
                    body: (
                      <p>
                        The current password stops working and every session ends. You get a
                        temporary password to hand over, shown once; it has to be changed at the
                        next sign-in.
                      </p>
                    ),
                    confirmLabel: 'Reset password',
                  });
                  if (ok) resetPassword.mutate(selected.user.id);
                }}
              >
                Reset password
              </Button>

              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Sign ${selected.user.username} out everywhere?`,
                    body: <p>Every session the account has open ends now; it can sign back in.</p>,
                    confirmLabel: 'Sign out everywhere',
                  });
                  if (!ok) return;
                  action.mutate(
                    { id: selected.user.id, path: 'force-logout' },
                    { onSuccess: () => succeed('All sessions ended.') },
                  );
                }}
              >
                Force logout
              </Button>

              {selected.user.totpEnabled && (
                <Button
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Reset two-factor for ${selected.user.username}?`,
                      body: (
                        <p>
                          The registered authenticator and recovery codes stop working. Until the
                          person enrols a new device, a password alone signs this account in.
                        </p>
                      ),
                      confirmLabel: 'Reset two-factor',
                    });
                    if (!ok) return;
                    action.mutate(
                      { id: selected.user.id, path: 'reset-2fa' },
                      {
                        onSuccess: () =>
                          succeed('Two-factor cleared — the user can enrol a new device.'),
                      },
                    );
                  }}
                >
                  Reset 2FA
                </Button>
              )}

              <Button
                variant="danger"
                className="px-2 py-1 text-xs"
                disabled={selected.user.id === me?.id}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${selected.user.username}?`,
                    body: (
                      <>
                        <p>
                          The account is removed from the console and can no longer sign in. This
                          cannot be undone here; disabling is the reversible alternative.
                        </p>
                        <p>
                          Cases and audit entries keep its name. An account still holding open cases
                          is refused until they are reassigned.
                        </p>
                      </>
                    ),
                    confirmLabel: 'Delete account',
                    typeToConfirm: selected.user.username,
                  });
                  if (!ok) return;
                  action.mutate(
                    { id: selected.user.id, path: '', method: 'DELETE' },
                    {
                      onSuccess: () => {
                        setSelectedId(null);
                        succeed('Account deleted.');
                      },
                    },
                  );
                }}
              >
                Delete
              </Button>
            </div>

            <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">
              <p className="mb-2 text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                Recent activity
              </p>
              <ul className="space-y-1 text-xs">
                {selected.recentActivity.slice(0, 8).map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-2">
                    <span>
                      {entry.action}{' '}
                      <span className="text-[var(--color-content-muted)]">{entry.entityType}</span>
                    </span>
                    <span className="text-[var(--color-content-muted)]">
                      {formatDateTime(entry.at)}
                    </span>
                  </li>
                ))}
                {selected.recentActivity.length === 0 && (
                  <li className="text-[var(--color-content-muted)]">No recorded activity.</li>
                )}
              </ul>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="py-10 text-center text-sm text-[var(--color-content-muted)]">
              Select an account to manage it.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-content-muted)]">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
