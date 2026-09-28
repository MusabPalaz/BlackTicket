import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  cx,
} from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';

interface Health {
  database: { reachable: boolean; latencyMs: number; sizeBytes: number };
  tables: { table: string; rows: number; totalBytes: number }[];
  auditTrail: { total: number; oldest: string | null; newest: string | null; appendOnly: boolean };
  checkedAt: string;
}

interface Purgeable {
  olderThanDays: number;
  cutoff: string;
  deletedUsers: number;
  deletedCases: number;
  expiredSessions: number;
  readNotifications: number;
}

interface ResetPreview {
  removes: {
    cases: number;
    tasks: number;
    observables: number;
    alerts: number;
    notifications: number;
    links: number;
  };
  keeps: { users: number; auditEntries: number; configuration: string[] };
}

type Target = 'deletedUsers' | 'deletedCases' | 'expiredSessions' | 'readNotifications';

/** Typed out in full, so the confirmation cannot be produced by a stray Enter. */
const RESET_PHRASE = 'DELETE';

const TARGETS: { key: Target; label: string; detail: string }[] = [
  {
    key: 'deletedCases',
    label: 'Deleted cases',
    detail: 'Cases already removed from the product, past the window.',
  },
  {
    key: 'deletedUsers',
    label: 'Deleted accounts',
    detail: 'Accounts already removed, past the window.',
  },
  {
    key: 'expiredSessions',
    label: 'Dead sessions',
    detail: 'Refresh tokens that expired or were revoked; none of them can authenticate.',
  },
  {
    key: 'readNotifications',
    label: 'Read notifications',
    detail: 'In-app notices their owner has already read.',
  },
];

const WINDOWS = [30, 90, 180, 365];

/**
 * What a database superuser has to run to prune the trail, spelled out rather
 * than described. The rule has to come off and go back on around the delete.
 */
const PRUNE_RUNBOOK = [
  'ALTER TABLE "audit_log" DISABLE RULE "audit_log_no_delete";',
  `DELETE FROM "audit_log" WHERE "createdAt" < now() - interval '365 days';`,
  'ALTER TABLE "audit_log" ENABLE RULE "audit_log_no_delete";',
].join('\n');

/** Bytes are what the database reports; people read megabytes. */
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Housekeeping for whoever runs the installation.
 *
 * Two halves that must not be confused: what the database is holding, and what
 * may be removed from it. The audit trail appears only in the first — the
 * screen says why rather than offering a button the database would refuse.
 */
export function SystemPage() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(90);
  const [pending, setPending] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /*
   * Where a failure has to be shown. The page is long enough that the reset
   * dialog sits nearly a thousand pixels below the fold, so an alert at the top
   * reads as no answer at all.
   */
  const [scopedError, setScopedError] = useState<{
    where: 'purge' | 'reset';
    message: string;
  } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.get<Health>('/admin/system/health'),
    refetchInterval: 30_000,
  });

  const purgeable = useQuery({
    queryKey: ['system-purgeable', days],
    queryFn: () => api.get<Purgeable>(`/admin/system/purgeable?olderThanDays=${days}`),
  });

  const purge = useMutation({
    mutationFn: (target: Target) =>
      api.post<{ target: Target; removed: number }>('/admin/system/purge', {
        target,
        olderThanDays: days,
      }),
    onSuccess: (result) => {
      setError(null);
      setScopedError(null);
      setPending(null);
      setNotice(`${result.removed} row(s) removed.`);
      void queryClient.invalidateQueries({ queryKey: ['system-purgeable'] });
      void queryClient.invalidateQueries({ queryKey: ['system-health'] });
    },
    onError: (caught) => {
      setNotice(null);
      setPending(null);
      setScopedError({
        where: 'purge',
        message: caught instanceof ApiError ? caught.detail : 'Could not reach the server.',
      });
    },
  });

  const resetPreview = useQuery({
    queryKey: ['system-reset-preview'],
    queryFn: () => api.get<ResetPreview>('/admin/system/reset-preview'),
  });

  const reset = useMutation({
    mutationFn: () =>
      api.post<Record<string, number>>('/admin/system/reset', { totpCode: totpCode.trim() }),
    onSuccess: (removed) => {
      setError(null);
      setScopedError(null);
      setResetOpen(false);
      setResetConfirm('');
      setTotpCode('');
      const total = Object.values(removed).reduce((sum, value) => sum + value, 0);
      setNotice(
        `Reset complete — ${total.toLocaleString()} record(s) removed. Accounts are intact.`,
      );
      void queryClient.invalidateQueries();
    },
    onError: (caught) => {
      setNotice(null);
      setScopedError({
        where: 'reset',
        message: caught instanceof ApiError ? caught.detail : 'Could not reach the server.',
      });
    },
  });

  const counts = purgeable.data;
  const removes = resetPreview.data?.removes;
  const resetTotal = removes ? Object.values(removes).reduce((sum, value) => sum + value, 0) : 0;
  const resetReady = resetConfirm.trim() === RESET_PHRASE && totpCode.trim().length >= 6;

  return (
    <div className="max-w-4xl space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">System health</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          What the database is holding, and what can safely be removed from it.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card title="Database">
        {health.isError ? (
          <ErrorState onRetry={() => void health.refetch()} />
        ) : !health.data ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                Reachable
              </p>
              <p
                className={cx(
                  'mt-1 text-sm font-medium',
                  health.data.database.reachable
                    ? 'text-[var(--color-tlp-green)]'
                    : 'text-[var(--color-severity-critical)]',
                )}
              >
                {health.data.database.reachable ? 'yes' : 'no'}
              </p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                Round trip
              </p>
              <p className="mt-1 text-sm font-medium tabular-nums">
                {health.data.database.latencyMs} ms
              </p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                On disk
              </p>
              <p className="mt-1 text-sm font-medium tabular-nums">
                {humanBytes(health.data.database.sizeBytes)}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card title="Largest tables" description="Row counts are PostgreSQL's live estimates.">
        {health.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Table</th>
                  <th className="pb-2 pr-3 text-right font-medium">Rows</th>
                  <th className="pb-2 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {health.data.tables.map((row) => (
                  <tr key={row.table} className="border-t border-[var(--color-border-subtle)]">
                    <td className="py-1.5 pr-3 font-mono text-xs">{row.table}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {row.rows.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{humanBytes(row.totalBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Audit trail">
        {health.data && (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                  Entries
                </dt>
                <dd className="mt-1 text-sm font-medium tabular-nums">
                  {health.data.auditTrail.total.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                  Oldest
                </dt>
                <dd className="mt-1 text-sm">
                  {health.data.auditTrail.oldest
                    ? formatDateTime(health.data.auditTrail.oldest)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                  Newest
                </dt>
                <dd className="mt-1 text-sm">
                  {health.data.auditTrail.newest
                    ? formatDateTime(health.data.auditTrail.newest)
                    : '—'}
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <Alert tone="info">
                <p className="font-medium">This trail cannot be pruned from here.</p>
                <p className="mt-0.5">
                  The database refuses UPDATE and DELETE on it for every role, including the one the
                  API connects with — a trail the application can rewrite is not a trail. Pruning is
                  a deliberate operation for whoever holds the database superuser:
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-[var(--color-surface)] p-2.5 font-mono text-[11px] leading-relaxed">
                  {PRUNE_RUNBOOK}
                </pre>
              </Alert>
            </div>
          </>
        )}
      </Card>

      <Card
        title="Housekeeping"
        description="Only rows the product has already retired. Nothing live is touched."
        actions={
          <Select
            value={String(days)}
            onChange={(event) => {
              setPending(null);
              setDays(Number(event.target.value));
            }}
            className="w-44"
          >
            {WINDOWS.map((value) => (
              <option key={value} value={value}>
                Older than {value} days
              </option>
            ))}
          </Select>
        }
      >
        {scopedError?.where === 'purge' && (
          <div className="mb-3">
            <Alert onDismiss={() => setScopedError(null)}>{scopedError.message}</Alert>
          </div>
        )}

        {counts && (
          <p className="mb-3 text-sm text-[var(--color-content-muted)]">
            Counting rows retired before{' '}
            <strong className="text-[var(--color-content)]">{formatDateTime(counts.cutoff)}</strong>
            .
          </p>
        )}

        {purgeable.isError ? (
          <ErrorState onRetry={() => void purgeable.refetch()} />
        ) : (
          <ul className="space-y-2">
            {TARGETS.map((target) => {
              const count = counts ? counts[target.key] : undefined;
              return (
                <li
                  key={target.key}
                  className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-subtle)] pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{target.label}</p>
                    <p className="text-xs text-[var(--color-content-muted)]">{target.detail}</p>
                  </div>
                  <span
                    className={cx(
                      'text-sm tabular-nums',
                      count === 0 && 'text-[var(--color-content-faint)]',
                    )}
                  >
                    {count === undefined
                      ? '…'
                      : count === 0
                        ? 'nothing yet'
                        : count.toLocaleString()}
                  </span>

                  {pending === target.key ? (
                    <span className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={purge.isPending}
                        onClick={() => purge.mutate(target.key)}
                      >
                        Remove {count?.toLocaleString()}
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!count}
                      onClick={() => {
                        setNotice(null);
                        setPending(target.key);
                      }}
                    >
                      Remove…
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-xs text-[var(--color-content-faint)]">
          Every purge is written to the audit trail.
        </p>
      </Card>

      {/*
       * The most destructive thing the product can do, so it is last, visually
       * separated, and asks for a second factor rather than a password — a
       * password is the credential most likely to be sitting in an unlocked
       * browser, which is the case this guard exists for.
       */}
      <Card
        title="Reset operational data"
        description="Removes every case, alert and indicator. Accounts and configuration stay."
        className="border-[var(--color-severity-critical)]/40"
      >
        {resetPreview.isError ? (
          <ErrorState onRetry={() => void resetPreview.refetch()} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs tracking-wide text-[var(--color-severity-critical)] uppercase">
                  Removed
                </p>
                <ul className="mt-1.5 space-y-0.5 text-sm">
                  {removes &&
                    Object.entries(removes).map(([name, value]) => (
                      <li key={name} className="flex justify-between gap-4">
                        <span className="text-[var(--color-content-muted)]">{name}</span>
                        <span className="tabular-nums">{value.toLocaleString()}</span>
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                <p className="text-xs tracking-wide text-[var(--color-tlp-green)] uppercase">
                  Kept
                </p>
                <ul className="mt-1.5 space-y-0.5 text-sm">
                  <li className="flex justify-between gap-4">
                    <span className="text-[var(--color-content-muted)]">accounts</span>
                    <span className="tabular-nums">
                      {resetPreview.data?.keeps.users.toLocaleString() ?? '…'}
                    </span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span className="text-[var(--color-content-muted)]">audit entries</span>
                    <span className="tabular-nums">
                      {resetPreview.data?.keeps.auditEntries.toLocaleString() ?? '…'}
                    </span>
                  </li>
                  {resetPreview.data?.keeps.configuration.map((item) => (
                    <li key={item} className="text-[var(--color-content-muted)]">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {!resetOpen ? (
              <Button
                variant="danger"
                className="mt-4"
                disabled={resetTotal === 0}
                onClick={() => {
                  setNotice(null);
                  setResetConfirm('');
                  setTotpCode('');
                  setResetOpen(true);
                }}
              >
                Reset everything…
              </Button>
            ) : (
              <div
                role="alertdialog"
                aria-label="Confirm reset"
                className="mt-4 space-y-3 rounded-[var(--radius-control)] border border-[var(--color-severity-critical)]/50 bg-[var(--color-severity-critical)]/8 p-3.5"
              >
                <p className="text-sm">
                  This removes <strong>{resetTotal.toLocaleString()}</strong> record(s) and cannot
                  be undone. The audit trail keeps the record of it.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Type ${RESET_PHRASE}`}>
                    <Input
                      value={resetConfirm}
                      onChange={(event) => setResetConfirm(event.target.value)}
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Code from your authenticator">
                    <Input
                      value={totpCode}
                      onChange={(event) => setTotpCode(event.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="font-mono tracking-widest"
                    />
                  </Field>
                </div>

                {scopedError?.where === 'reset' && (
                  <Alert onDismiss={() => setScopedError(null)}>{scopedError.message}</Alert>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setResetOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!resetReady}
                    loading={reset.isPending}
                    onClick={() => reset.mutate()}
                  >
                    Delete everything
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
