import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card, ErrorState, Input, cx } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';
import type { AuditEntry, Paginated } from './types';

const controlClass =
  'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]';

const ENTITY_TYPES = [
  'Case',
  'CaseTask',
  'TaskLog',
  'CaseObservable',
  'User',
  'UserImport',
  'Alert',
  'ApiKey',
  'SystemSetting',
  'SlaPolicy',
  'Category',
  'CorrelationWhitelist',
  'RefreshToken',
];

/** Renders `before`/`after` as a compact field-level diff. */
function describeDiff(entry: AuditEntry): string | null {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const format = (value: unknown) =>
    value === null || value === undefined
      ? 'none'
      : Array.isArray(value)
        ? value.join(', ') || 'none'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);

  const parts = keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${key}: ${format(before[key])} → ${format(after[key])}`);

  return parts.length ? parts.join(' · ') : null;
}

export function AuditLogPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);
  if (entityId.trim()) params.set('entityId', entityId.trim());
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(to).toISOString());
  params.set('page', String(page));
  params.set('size', '50');

  const actions = useQuery({
    queryKey: ['audit-actions'],
    queryFn: () => api.get<{ items: string[] }>('/admin/audit/actions'),
    staleTime: 5 * 60_000,
  });

  const entries = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => api.get<Paginated<AuditEntry>>(`/admin/audit?${params.toString()}`),
  });

  async function exportCsv() {
    const query = new URLSearchParams(params);
    query.set('csv', 'true');
    // Fetched through the API client so the bearer token is attached; a plain
    // link would be unauthenticated.
    const text = await api.get<string>(`/admin/audit?${query.toString()}`);
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Append-only. The database itself rejects changes and deletions, so this is a record, not a
          log that can be tidied up.
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            className={controlClass}
          >
            <option value="">Any action</option>
            {actions.data?.items.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value);
              setPage(1);
            }}
            className={controlClass}
          >
            <option value="">Any entity</option>
            {ENTITY_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <Input
            value={entityId}
            onChange={(event) => {
              setEntityId(event.target.value);
              setPage(1);
            }}
            placeholder="Entity id"
            className="w-64 font-mono text-xs"
          />

          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={controlClass}
          />
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={controlClass}
          />

          <Button variant="secondary" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        </div>
      </Card>

      {entries.isError && (
        <Card>
          <ErrorState onRetry={() => void entries.refetch()} />
        </Card>
      )}

      {!entries.isError && (
        <Card title={`${entries.data?.total ?? 0} entr(ies)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="pb-2 pr-3 font-medium">When</th>
                  <th className="pb-2 pr-3 font-medium">Actor</th>
                  <th className="pb-2 pr-3 font-medium">Action</th>
                  <th className="pb-2 pr-3 font-medium">Entity</th>
                  <th className="pb-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {entries.data?.items.map((entry) => {
                  const diff = describeDiff(entry);
                  return (
                    <tr
                      key={entry.id}
                      className="border-t border-[var(--color-border-subtle)] align-top"
                    >
                      <td className="py-2 pr-3 text-xs whitespace-nowrap text-[var(--color-content-muted)]">
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {entry.actor?.username ?? (
                          <span className="text-[var(--color-content-muted)]">system</span>
                        )}
                        {entry.actorIp && (
                          <span className="block font-mono text-[11px] text-[var(--color-content-muted)]">
                            {entry.actorIp}
                          </span>
                        )}
                      </td>
                      <td
                        className={cx(
                          'py-2 pr-3 text-xs',
                          entry.action.includes('FAILURE') && 'text-[var(--color-severity-medium)]',
                          (entry.action.includes('LOCKED') || entry.action.includes('REUSE')) &&
                            'text-[var(--color-severity-critical)]',
                        )}
                      >
                        {entry.action}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {entry.entityType}
                        {entry.entityId && (
                          <span className="block font-mono text-[11px] text-[var(--color-content-muted)]">
                            {entry.entityId.slice(0, 8)}…
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        {diff && <span className="font-mono">{diff}</span>}
                        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                          <span className="block text-[var(--color-content-muted)]">
                            {JSON.stringify(entry.metadata)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {entries.data && entries.data.pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-[var(--color-content-muted)]">
                Page {entries.data.page} of {entries.data.pages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= entries.data.pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
