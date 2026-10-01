import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaseStatus, Permission, Severity } from '@black-ticket/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { describeWindow } from '@/lib/date-window';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
  cx,
} from '@/components/ui';
import { IconCases, IconClose, IconSearch } from '@/components/icons';
import { SeverityChip, StatusChip, formatRelativeDeadline } from '@/components/case-bits';
import type { CaseRecord, CategoryRef, Paginated, PersonRef } from './types';

const OPEN_STATUSES = [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING];

const SEVERITY_BORDER: Record<Severity, string> = {
  LOW: 'border-l-[var(--color-severity-low)]',
  MEDIUM: 'border-l-[var(--color-severity-medium)]',
  HIGH: 'border-l-[var(--color-severity-high)]',
  CRITICAL: 'border-l-[var(--color-severity-critical)]',
};

/** Filters the list understands. Everything here survives a page reload. */
const FILTER_KEYS = [
  'status',
  'severity',
  'assigneeId',
  'categoryId',
  'tag',
  'mitre',
  'breached',
  'unassigned',
  'from',
  'to',
  'dateField',
  'q',
] as const;

/**
 * "Opened on 2026-10-01" for a one-day drill-down, "Opened 2026-10-02
 * 14:00–15:00" for an hour of the trend, "Closed since 2026-10-01 09:12" for
 * the last 24 hours. Times are the reader's local ones.
 */
function dateWindowLabel(params: URLSearchParams): string {
  const field =
    { createdAt: 'Opened', closedAt: 'Closed' }[params.get('dateField') ?? ''] ?? 'Occurred';
  return `${field} ${describeWindow(params.get('from')!, params.get('to'))}`;
}

export function CasesListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const [search, setSearch] = useState(params.get('q') ?? '');

  const page = Number(params.get('page') ?? '1');
  const status = params.get('status') ?? 'open';

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function clearAll() {
    setParams(new URLSearchParams({ status: 'open' }));
    setSearch('');
  }

  useEffect(() => {
    if ((params.get('q') ?? '') === search.trim()) return;
    const timer = setTimeout(() => setParam('q', search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Keep the box in step when a drill-down replaces the query string. Keyed on
  // the term itself rather than on the parameter object: that object is new on
  // every filter or page change, and reacting to those would overwrite whatever
  // someone had half-typed while the debounce above was still pending.
  const urlQuery = params.get('q') ?? '';
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (syncedQuery !== urlQuery) {
    setSyncedQuery(urlQuery);
    setSearch(urlQuery);
  }

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (!value) continue;
    if (key === 'status') {
      if (value === 'open') query.set('status', OPEN_STATUSES.join(','));
      else if (value !== 'all') query.set('status', value);
    } else {
      query.set(key, value);
    }
  }
  if (status === 'open' && !query.has('status')) query.set('status', OPEN_STATUSES.join(','));
  query.set('page', String(page));
  query.set('size', '25');

  const cases = useQuery({
    queryKey: ['cases', query.toString()],
    queryFn: () => api.get<Paginated<CaseRecord>>(`/cases?${query.toString()}`),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ items: CategoryRef[] }>('/categories'),
    staleTime: 5 * 60_000,
  });

  const people = useQuery({
    queryKey: ['assignable'],
    queryFn: () => api.get<{ items: PersonRef[] }>('/users/assignable'),
    staleTime: 5 * 60_000,
  });

  /**
   * Chips for everything narrowing the list.
   *
   * Arriving here from a dashboard click means the filters were set by
   * something the analyst clicked rather than typed — so the page has to say
   * out loud why it is showing 12 rows instead of 400, and let them undo it in
   * one click.
   */
  const activeFilters = [
    params.get('severity') && { key: 'severity', label: `Severity: ${params.get('severity')}` },
    params.get('tag') && { key: 'tag', label: `Tag: ${params.get('tag')}` },
    params.get('mitre') && { key: 'mitre', label: `Technique: ${params.get('mitre')}` },
    params.get('breached') === 'true' && { key: 'breached', label: 'SLA breached' },
    params.get('breached') === 'false' && { key: 'breached', label: 'Within SLA' },
    params.get('unassigned') === 'true' && { key: 'unassigned', label: 'Unassigned' },
    params.get('assigneeId') && {
      key: 'assigneeId',
      label: `Assignee: ${
        params.get('assigneeId') === user?.id
          ? 'me'
          : (people.data?.items.find((person) => person.id === params.get('assigneeId'))
              ?.fullName ?? 'selected')
      }`,
    },
    params.get('categoryId') && {
      key: 'categoryId',
      label: `Category: ${
        categories.data?.items.find((category) => category.id === params.get('categoryId'))?.name ??
        'selected'
      }`,
    },
    params.get('from') && {
      key: 'from',
      label: dateWindowLabel(params),
      // The window is one filter to the reader; dropping only its start
      // would leave the end narrowing the list with no chip to show for it.
      clears: ['from', 'to', 'dateField'],
    },
  ].filter(Boolean) as { key: string; label: string; clears?: string[] }[];

  function removeFilter(filter: { key: string; clears?: string[] }) {
    const next = new URLSearchParams(params);
    for (const key of filter.clears ?? [filter.key]) next.delete(key);
    next.delete('page');
    setParams(next);
  }

  const presets: { label: string; apply: Record<string, string> }[] = [
    { label: 'Open', apply: { status: 'open' } },
    { label: 'Mine', apply: { status: 'open', assigneeId: user?.id ?? '' } },
    { label: 'Unassigned', apply: { status: 'open', unassigned: 'true' } },
    { label: 'Breached', apply: { status: 'open', breached: 'true' } },
    { label: 'Critical', apply: { status: 'open', severity: Severity.CRITICAL } },
  ];

  function applyPreset(apply: Record<string, string>) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(apply)) if (value) next.set(key, value);
    setParams(next);
  }

  function isPresetActive(apply: Record<string, string>) {
    const current = new URLSearchParams(params);
    current.delete('page');
    const target = new URLSearchParams();
    for (const [key, value] of Object.entries(apply)) if (value) target.set(key, value);
    return current.toString() === target.toString();
  }

  return (
    <div className="space-y-4 p-6 sm:p-8">
      <PageHeader
        title="Cases"
        description={
          cases.data
            ? `${cases.data.total} case(s)${activeFilters.length ? ' matching these filters' : ''}`
            : 'Loading…'
        }
        actions={
          hasPermission(Permission.CASE_CREATE) && (
            <Button onClick={() => navigate('/cases/new')}>
              New case <kbd className="ml-1 border-black/20 text-black/60">c</kbd>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => applyPreset(preset.apply)}
            className={cx(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              isPresetActive(preset.apply)
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-border-subtle)] text-[var(--color-content-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-content)]',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <Card bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-[var(--color-content-faint)]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, description, tag or case number…"
              className="pl-8"
            />
          </div>

          <Select
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            className="w-auto"
          >
            <option value="open">Open</option>
            <option value="all">All statuses</option>
            {Object.values(CaseStatus).map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ')}
              </option>
            ))}
          </Select>

          <Select
            value={params.get('severity') ?? ''}
            onChange={(event) => setParam('severity', event.target.value)}
            className="w-auto"
          >
            <option value="">Any severity</option>
            {Object.values(Severity).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>

          <Select
            value={params.get('assigneeId') ?? ''}
            onChange={(event) => setParam('assigneeId', event.target.value)}
            className="w-auto"
          >
            <option value="">Anyone</option>
            {user && <option value={user.id}>Assigned to me</option>}
            {people.data?.items
              .filter((person) => person.id !== user?.id)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
          </Select>

          <Select
            value={params.get('categoryId') ?? ''}
            onChange={(event) => setParam('categoryId', event.target.value)}
            className="w-auto"
          >
            <option value="">Any category</option>
            {categories.data?.items.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>

        {activeFilters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border-subtle)] pt-3">
            <span className="text-xs text-[var(--color-content-faint)]">Filtered by</span>
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                onClick={() => removeFilter(filter)}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-xs text-[var(--color-accent)] hover:border-[var(--color-accent)]"
              >
                {filter.label}
                <IconClose className="h-3 w-3" />
              </button>
            ))}
            <button
              onClick={clearAll}
              className="ml-1 text-xs text-[var(--color-content-muted)] underline hover:text-[var(--color-content)]"
            >
              Clear all
            </button>
          </div>
        )}
      </Card>

      <Card bodyClassName="p-0">
        {cases.isLoading ? (
          <div className="p-5">
            <TableSkeleton rows={8} columns={5} />
          </div>
        ) : cases.isError ? (
          <ErrorState onRetry={() => void cases.refetch()} />
        ) : cases.data?.items.length === 0 ? (
          <EmptyState
            icon={<IconCases className="h-8 w-8" />}
            title="No cases match these filters"
            description={
              activeFilters.length > 0
                ? 'Try removing a filter, or clear them all.'
                : 'Nothing has been opened yet.'
            }
            action={
              activeFilters.length > 0 ? (
                <Button variant="secondary" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : hasPermission(Permission.CASE_CREATE) ? (
                <Button onClick={() => navigate('/cases/new')}>Open the first case</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--color-surface-raised)] text-xs text-[var(--color-content-muted)] uppercase">
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <th className="py-2.5 pr-3 pl-5 font-medium">Case</th>
                  <th className="py-2.5 pr-3 font-medium">Title</th>
                  <th className="py-2.5 pr-3 font-medium">Severity</th>
                  <th className="py-2.5 pr-3 font-medium">Status</th>
                  <th className="py-2.5 pr-3 font-medium">Assignee</th>
                  <th className="py-2.5 pr-3 font-medium">SLA</th>
                  <th className="py-2.5 pr-5 font-medium">Opened</th>
                </tr>
              </thead>
              <tbody>
                {cases.data?.items.map((row) => {
                  const closed =
                    row.status === CaseStatus.CLOSED || row.status === CaseStatus.RESOLVED;
                  const sla = formatRelativeDeadline(row.slaDueAt, closed);
                  return (
                    <tr
                      key={row.id}
                      className={cx(
                        'group border-b border-l-2 border-[var(--color-border-subtle)] transition-colors last:border-b-0',
                        SEVERITY_BORDER[row.severity],
                        'hover:bg-[var(--color-surface-overlay)]',
                      )}
                    >
                      <td className="py-2.5 pr-3 pl-5 font-mono text-xs whitespace-nowrap">
                        <Link to={`/cases/${row.id}`} className="hover:text-[var(--color-accent)]">
                          {row.reference}
                        </Link>
                      </td>
                      <td className="max-w-md py-2.5 pr-3">
                        <Link
                          to={`/cases/${row.id}`}
                          className="group-hover:text-[var(--color-accent)]"
                        >
                          {row.title}
                        </Link>
                        {row.tags.length > 0 && (
                          <span className="ml-2 text-xs text-[var(--color-content-faint)]">
                            {row.tags.map((tag) => `#${tag}`).join(' ')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <SeverityChip value={row.severity} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusChip value={row.status} />
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {row.assignee?.fullName ?? (
                          <span className="text-[var(--color-severity-medium)]">unassigned</span>
                        )}
                      </td>
                      <td
                        className={cx(
                          'py-2.5 pr-3 text-xs whitespace-nowrap tabular-nums',
                          sla.overdue && 'text-[var(--color-severity-critical)]',
                        )}
                      >
                        {sla.label}
                      </td>
                      <td className="py-2.5 pr-5 text-xs whitespace-nowrap text-[var(--color-content-faint)]">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {cases.data && cases.data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-5 py-3 text-sm">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
            >
              Previous
            </Button>
            <span className="text-xs text-[var(--color-content-muted)]">
              Page {cases.data.page} of {cases.data.pages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= cases.data.pages}
              onClick={() => setParam('page', String(page + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
