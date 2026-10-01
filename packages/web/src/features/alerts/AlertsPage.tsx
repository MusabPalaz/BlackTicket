import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertStatus, Permission, type Severity } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { IndicatorLookup } from '@/components/IndicatorLookup';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  cx,
} from '@/components/ui';
import { IconAlerts, IconChevronRight, IconClose, IconSearch } from '@/components/icons';
import { SeverityChip, formatDateTime } from '@/components/case-bits';
import type { CaseRecord, Paginated } from '@/features/cases/types';
import type { AlertRecord } from './types';

const STATUS_TONE: Record<string, 'accent' | 'warn' | 'good' | 'neutral'> = {
  NEW: 'accent',
  TRIAGED: 'warn',
  IMPORTED: 'good',
  IGNORED: 'neutral',
};

const SEVERITY_BORDER: Record<string, string> = {
  LOW: 'border-l-[var(--color-severity-low)]',
  MEDIUM: 'border-l-[var(--color-severity-medium)]',
  HIGH: 'border-l-[var(--color-severity-high)]',
  CRITICAL: 'border-l-[var(--color-severity-critical)]',
};

/**
 * The triage queue.
 *
 * Filters live in the URL so a dashboard click can land here already narrowed —
 * and so "the imported alerts from Wazuh" is a link somebody can paste into a
 * handover note.
 */
export function AlertsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((state) => state.hasPermission);

  const status = params.get('status') ?? AlertStatus.NEW;
  const source = params.get('source') ?? '';
  /** Set by the dashboard, whose source chart counts a recent window only. */
  const receivedFrom = params.get('from') ?? '';
  const search = params.get('q') ?? '';

  const [openId, setOpenId] = useState<string | null>(null);
  /** Merge state is per alert: sharing it made it possible to open a second
      alert and merge it into the case picked for the first one. */
  const [merge, setMerge] = useState<{ alertId: string; term: string; caseId: string } | null>(
    null,
  );

  const canTriage = hasPermission(Permission.ALERT_IMPORT);
  /** Dismissing and un-dismissing are a SOC lead's call, not every analyst's. */
  const canIgnore = hasPermission(Permission.ALERT_IGNORE);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  const query = new URLSearchParams();
  if (status !== 'all') query.set('status', status);
  if (source) query.set('source', source);
  if (receivedFrom) query.set('from', receivedFrom);
  if (search) query.set('q', search);
  query.set('size', '50');

  const alerts = useQuery({
    queryKey: ['alerts', query.toString()],
    queryFn: () => api.get<Paginated<AlertRecord>>(`/alerts?${query.toString()}`),
    refetchInterval: 30_000,
  });

  const candidates = useQuery({
    queryKey: ['merge-candidates', merge?.term],
    queryFn: () =>
      api.get<Paginated<CaseRecord>>(`/cases?q=${encodeURIComponent(merge?.term ?? '')}&size=8`),
    enabled: Boolean(merge && merge.term.trim().length > 1),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    void queryClient.invalidateQueries({ queryKey: ['alert-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['metrics'] });
  }

  function fail(caught: unknown) {
    toast.error(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const importAlert = useMutation({
    mutationFn: (id: string) =>
      api.post<{
        case: CaseRecord;
        observables: { added: unknown[]; correlations: { reference: string }[] };
      }>(`/alerts/${id}/import`, {}),
    onSuccess: (result) => {
      const correlations = result.observables.correlations.length;
      toast.success(
        `Opened ${result.case.reference}`,
        correlations > 0
          ? `${correlations} correlation(s) found while importing the indicators.`
          : `${result.observables.added.length} indicator(s) carried across.`,
      );
      refresh();
      navigate(`/cases/${result.case.id}`);
    },
    onError: fail,
  });

  const mergeAlert = useMutation({
    mutationFn: ({ id, caseId }: { id: string; caseId: string }) =>
      api.post<{ case: CaseRecord }>(`/alerts/${id}/merge`, { caseId }),
    onSuccess: (result) => {
      toast.success(`Merged into ${result.case.reference}`);
      setMerge(null);
      refresh();
    },
    onError: fail,
  });

  const ignoreAlert = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/alerts/${id}/ignore`, { reason }),
    onSuccess: () => {
      toast.success('Alert dismissed', 'The reason is kept in the audit trail.');
      refresh();
    },
    onError: fail,
  });

  const restoreAlert = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/alerts/${id}/restore`, { reason: reason || undefined }),
    onSuccess: () => {
      toast.success(
        'Alert back in the queue',
        'It is NEW again; the reason is in the audit trail.',
      );
      refresh();
    },
    onError: fail,
  });

  const activeFilters = [
    source && { key: 'source', label: `Source: ${source}` },
    receivedFrom && {
      key: 'from',
      label: `Received since ${new Date(receivedFrom).toLocaleDateString('en-CA')}`,
    },
    search && { key: 'q', label: `Search: ${search}` },
    status !== AlertStatus.NEW && status !== 'all' && { key: 'status', label: `Status: ${status}` },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <div className="space-y-4 p-6 sm:p-8">
      <PageHeader
        title="Alert Queue"
        description={
          alerts.data ? `${alerts.data.total} alert(s) · refreshes every 30s` : 'Loading…'
        }
      />

      <Card bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-[var(--color-content-faint)]" />
            <Input
              defaultValue={search}
              onKeyDown={(event) => {
                if (event.key === 'Enter')
                  setParam('q', (event.target as HTMLInputElement).value.trim());
              }}
              placeholder="Search title or source id, then press Enter…"
              className="pl-8"
            />
          </div>

          <Select
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            className="w-auto"
          >
            <option value="all">All</option>
            {Object.values(AlertStatus).map((value) => (
              <option key={value} value={value}>
                {value}
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
                onClick={() => setParam(filter.key, filter.key === 'status' ? AlertStatus.NEW : '')}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-xs text-[var(--color-accent)]"
              >
                {filter.label}
                <IconClose className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </Card>

      {alerts.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      )}

      {alerts.isError && (
        <Card>
          <ErrorState onRetry={() => void alerts.refetch()} />
        </Card>
      )}

      {alerts.data?.items.length === 0 && (
        <Card>
          <EmptyState
            icon={<IconAlerts className="h-8 w-8" />}
            title="Nothing in this view"
            description="Point a SIEM at POST /api/v1/ingest/alerts with an API key, or widen the filter."
          />
        </Card>
      )}

      <div className="space-y-3">
        {alerts.data?.items.map((alert) => {
          const isOpen = openId === alert.id;
          const mergeState = merge?.alertId === alert.id ? merge : null;
          const detailsId = `alert-${alert.id}-details`;
          const toggle = () => setOpenId(isOpen ? null : alert.id);

          return (
            <Card
              key={alert.id}
              className={cx(
                'border-l-2 transition-colors hover:border-[var(--color-border-strong)]',
                SEVERITY_BORDER[alert.severity] ?? 'border-l-transparent',
              )}
              bodyClassName="p-4"
            >
              {/*
               * The whole header opens the details for the mouse; the title is
               * the real button, for the keyboard and screen readers. Controls
               * in the header keep their own job, and a drag that selected text
               * — an ID someone is copying — is not a click.
               */}
              <div
                className="flex cursor-pointer flex-wrap items-start justify-between gap-3"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) {
                    return;
                  }
                  if (window.getSelection()?.toString()) return;
                  toggle();
                }}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[alert.status] ?? 'neutral'}>{alert.status}</Badge>
                    <SeverityChip value={alert.severity as Severity} />
                    <button
                      onClick={() => setParam('source', alert.source)}
                      className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
                      title={`Show everything from ${alert.source}`}
                    >
                      {alert.source}
                    </button>
                    <span className="font-mono text-xs text-[var(--color-content-faint)]">
                      {alert.externalId}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={isOpen}
                    aria-controls={detailsId}
                    className="mt-1.5 flex items-start gap-1.5 text-left text-sm font-medium hover:text-[var(--color-accent)]"
                  >
                    <IconChevronRight
                      className={cx(
                        'mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-content-faint)] transition-transform',
                        isOpen && 'rotate-90',
                      )}
                    />
                    {alert.title}
                  </button>
                  <p className="mt-0.5 text-xs text-[var(--color-content-faint)]">
                    {formatDateTime(alert.receivedAt)}
                    {alert.case && (
                      <>
                        {' · '}
                        <button
                          onClick={() => navigate(`/cases/${alert.case!.id}`)}
                          className="underline hover:text-[var(--color-accent)]"
                        >
                          {alert.case.reference}
                        </button>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canTriage && alert.status !== 'IMPORTED' && (
                    <>
                      <Button
                        size="sm"
                        loading={importAlert.isPending}
                        onClick={() => importAlert.mutate(alert.id)}
                      >
                        Open case
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setOpenId(alert.id);
                          setMerge({ alertId: alert.id, term: '', caseId: '' });
                        }}
                      >
                        Merge
                      </Button>
                    </>
                  )}
                  {canIgnore && alert.status === 'IGNORED' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={restoreAlert.isPending && restoreAlert.variables?.id === alert.id}
                      onClick={async () => {
                        const answer = await confirm({
                          title: 'Put this alert back in the queue?',
                          body: (
                            <p>
                              <strong className="text-[var(--color-content)]">{alert.title}</strong>{' '}
                              becomes NEW again and shows up in the triage queue, where it can be
                              opened as a case, merged or ignored again.
                            </p>
                          ),
                          confirmLabel: 'Restore to queue',
                          tone: 'primary',
                          fields: [
                            {
                              name: 'reason',
                              label: 'Reason',
                              kind: 'textarea',
                              hint: 'Kept in the audit trail',
                              placeholder: 'e.g. the scanner turned out not to be ours',
                              maxLength: 500,
                            },
                          ],
                        });
                        if (answer)
                          restoreAlert.mutate({ id: alert.id, reason: answer.values.reason ?? '' });
                      }}
                    >
                      Restore
                    </Button>
                  )}
                  {canIgnore && alert.status !== 'IMPORTED' && alert.status !== 'IGNORED' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        const answer = await confirm({
                          title: 'Ignore this alert?',
                          body: (
                            <>
                              <p>
                                <strong className="text-[var(--color-content)]">
                                  {alert.title}
                                </strong>{' '}
                                leaves the queue without a case, and its indicators are not
                                correlated.
                              </p>
                              <p>
                                It stays under the IGNORED filter, where it can still be opened as a
                                case or put back in the queue.
                              </p>
                            </>
                          ),
                          confirmLabel: 'Ignore alert',
                          fields: [
                            {
                              name: 'reason',
                              label: 'Reason',
                              kind: 'textarea',
                              hint: 'Kept in the audit trail',
                              placeholder: 'e.g. known scanner, false positive',
                              maxLength: 500,
                            },
                          ],
                        });
                        if (!answer) return;
                        ignoreAlert.mutate({
                          id: alert.id,
                          reason: answer.values.reason || 'Dismissed from the queue',
                        });
                      }}
                    >
                      Ignore
                    </Button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div
                  id={detailsId}
                  className="animate-in mt-4 space-y-3 border-t border-[var(--color-border-subtle)] pt-4"
                >
                  {alert.description && (
                    <p className="text-sm whitespace-pre-wrap">{alert.description}</p>
                  )}

                  {alert.observables.length > 0 && (
                    <div>
                      <p className="text-xs tracking-wide text-[var(--color-content-faint)] uppercase">
                        Indicators ({alert.observables.length})
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {alert.observables.map((observable, index) => (
                          <li key={`${observable.type}-${index}`} className="flex gap-2 text-sm">
                            <span className="w-28 shrink-0 text-xs text-[var(--color-content-faint)]">
                              {observable.type}
                            </span>
                            <IndicatorLookup type={observable.type} value={observable.value}>
                              <span className="font-mono text-xs break-all">
                                {observable.value}
                              </span>
                            </IndicatorLookup>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {alert.mitre.length > 0 && (
                    <p className="text-xs text-[var(--color-content-muted)]">
                      MITRE: <span className="font-mono">{alert.mitre.join(', ')}</span>
                    </p>
                  )}

                  <details>
                    <summary className="cursor-pointer text-xs text-[var(--color-content-muted)] hover:text-[var(--color-content)]">
                      Raw payload
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-xs">
                      {JSON.stringify(alert.raw, null, 2)}
                    </pre>
                  </details>

                  {mergeState && (
                    <div className="border-t border-[var(--color-border-subtle)] pt-3">
                      <p className="mb-2 text-xs tracking-wide text-[var(--color-content-faint)] uppercase">
                        Merge into an existing case
                      </p>
                      <Input
                        value={mergeState.term}
                        onChange={(event) => setMerge({ ...mergeState, term: event.target.value })}
                        placeholder="Search case title or number…"
                        autoFocus
                      />
                      {candidates.data && candidates.data.items.length > 0 && (
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
                          {candidates.data.items.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => setMerge({ ...mergeState, caseId: row.id })}
                              className={cx(
                                'flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-left text-sm last:border-b-0',
                                'hover:bg-[var(--color-surface-overlay)]',
                                mergeState.caseId === row.id && 'bg-[var(--color-surface-overlay)]',
                              )}
                            >
                              <span className="font-mono text-xs">{row.reference}</span>
                              <span className="flex-1 truncate">{row.title}</span>
                              <SeverityChip value={row.severity} />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={!mergeState.caseId}
                          loading={mergeAlert.isPending}
                          onClick={() =>
                            mergeAlert.mutate({ id: alert.id, caseId: mergeState.caseId })
                          }
                        >
                          Merge
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setMerge(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
