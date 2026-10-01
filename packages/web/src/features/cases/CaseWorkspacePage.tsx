import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CASE_STATUS_TRANSITIONS,
  CaseResolution,
  CaseStatus,
  Permission,
} from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Alert, Button, Card, cx } from '@/components/ui';
import {
  SeverityChip,
  StatusChip,
  TlpChip,
  formatDateTime,
  formatRelativeDeadline,
} from '@/components/case-bits';
import { CaseOverviewTab } from './CaseOverviewTab';
import { CaseTasksTab } from './CaseTasksTab';
import { CaseTimelineTab } from './CaseTimelineTab';
import { CaseObservablesTab } from './CaseObservablesTab';
import { CaseRelatedTab } from './CaseRelatedTab';
import { useConfirm } from '@/components/ConfirmDialog';
import type { CaseRecord, PersonRef } from './types';

type Tab = 'overview' | 'tasks' | 'observables' | 'related' | 'timeline';

export function CaseWorkspacePage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const user = useAuthStore((state) => state.user);
  const hasPermission = useAuthStore((state) => state.hasPermission);

  /*
   * The open tab is part of the address, not component state: a link to a
   * case's Related tab can be pasted into a handover note, and the browser
   * back button steps through tabs the way people expect it to.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab | null) ?? 'overview';
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const [error, setError] = useState<string | null>(null);

  const caseQuery = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.get<CaseRecord>(`/cases/${id}`),
  });

  const people = useQuery({
    queryKey: ['assignable'],
    queryFn: () => api.get<{ items: PersonRef[] }>('/users/assignable'),
    staleTime: 5 * 60_000,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['case', id] });
    void queryClient.invalidateQueries({ queryKey: ['case-timeline', id] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  }

  function fail(caught: unknown) {
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const changeStatus = useMutation({
    mutationFn: (status: CaseStatus) => api.post(`/cases/${id}/status`, { status }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const assign = useMutation({
    mutationFn: (userId: string | null) => api.post(`/cases/${id}/assign`, { userId }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail,
  });

  // Runs from its dialog, which shows a refusal itself and keeps the summary.
  const close = useMutation({
    mutationFn: (body: { resolution: CaseResolution; summary: string }) =>
      api.post(`/cases/${id}/close`, body),
    onSuccess: () => {
      setError(null);
      refresh();
    },
  });

  const reopen = useMutation({
    mutationFn: () => api.post(`/cases/${id}/reopen`, {}),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail,
  });

  if (caseQuery.isLoading) {
    return <div className="p-8 text-sm text-[var(--color-content-muted)]">Loading case…</div>;
  }
  if (caseQuery.isError || !caseQuery.data) {
    return (
      <div className="p-8">
        <Alert>Case not found, or you are not allowed to see it.</Alert>
      </div>
    );
  }

  const record = caseQuery.data;
  const isClosed = record.status === CaseStatus.CLOSED;
  const mine = user?.id === record.reporter.id || user?.id === record.assignee?.id;

  // Mirrors the server rule; the API re-checks every one of these.
  const canEdit =
    !isClosed &&
    (hasPermission(Permission.CASE_UPDATE_ANY) ||
      (mine && hasPermission(Permission.CASE_UPDATE_OWN)));
  const canClose =
    hasPermission(Permission.CASE_CLOSE_ANY) || (mine && hasPermission(Permission.CASE_CLOSE_OWN));
  const canAssignAnyone = hasPermission(Permission.CASE_ASSIGN_ANY);
  const canTake =
    hasPermission(Permission.CASE_ASSIGN_SELF) && !isClosed && (!record.assignee || mine);

  const nextStatuses = CASE_STATUS_TRANSITIONS[record.status].filter(
    (status) => status !== CaseStatus.RESOLVED && status !== CaseStatus.CLOSED,
  );
  const sla = formatRelativeDeadline(record.slaDueAt, isClosed);

  return (
    <div className="space-y-4 p-8">
      <nav className="text-xs text-[var(--color-content-muted)]">
        <Link to="/cases" className="hover:underline">
          Cases
        </Link>{' '}
        / <span className="font-mono">{record.reference}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{record.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip value={record.status} />
            <SeverityChip value={record.severity} />
            <TlpChip value={record.tlp} />
            <TlpChip value={record.pap} label="PAP" />
            {record.category && (
              <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-content-muted)]">
                {record.category.name}
              </span>
            )}
            {record.resolution && (
              <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[11px]">
                {record.resolution.replace('_', ' ')}
              </span>
            )}
            <span
              className={cx(
                'text-xs',
                sla.overdue ? 'text-[var(--color-severity-critical)]' : 'text-[var(--color-content-muted)]',
              )}
            >
              SLA {sla.label}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {nextStatuses.map((status) => (
            <Button
              key={status}
              variant="secondary"
              disabled={!canEdit || changeStatus.isPending}
              onClick={() => changeStatus.mutate(status)}
            >
              {status === CaseStatus.PENDING ? 'Put on hold' : 'Start work'}
            </Button>
          ))}

          {canTake &&
            (record.assignee ? (
              <Button variant="secondary" onClick={() => assign.mutate(null)}>
                Release
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => assign.mutate(user?.id ?? null)}>
                Take case
              </Button>
            ))}

          {!isClosed && canClose && (
            <Button
              loading={close.isPending}
              onClick={() =>
                void confirm({
                  title: `Close ${record.reference}?`,
                  body: (
                    <p>
                      The resolution and summary are what the next shift — and anyone who finds this
                      case through a shared indicator — will read.
                    </p>
                  ),
                  confirmLabel: 'Close case',
                  tone: 'primary',
                  fields: [
                    {
                      name: 'resolution',
                      label: 'Resolution',
                      kind: 'select',
                      options: Object.values(CaseResolution).map((value) => ({
                        value,
                        label: value.split('_').join(' '),
                      })),
                    },
                    {
                      name: 'summary',
                      label: 'Closing summary',
                      kind: 'textarea',
                      hint: 'What happened, what was done, what the next shift needs to know.',
                      required: true,
                      minLength: 10,
                      maxLength: 5_000,
                    },
                  ],
                  onConfirm: ({ resolution, summary }) =>
                    close.mutateAsync({
                      resolution: resolution as CaseResolution,
                      summary: summary ?? '',
                    }),
                })
              }
            >
              Close case
            </Button>
          )}
          {isClosed && canClose && (
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await confirm({
                  title: `Reopen ${record.reference}?`,
                  body: (
                    <p>
                      The case goes back to IN PROGRESS. Its resolution and closing time are
                      cleared, and it counts as open work again — on the dashboard and against its
                      SLA.
                    </p>
                  ),
                  confirmLabel: 'Reopen case',
                  tone: 'primary',
                });
                if (ok) reopen.mutate();
              }}
            >
              Reopen
            </Button>
          )}
        </div>
      </header>

      {error && <Alert>{error}</Alert>}

      {isClosed && record.summary && (
        <Card title={`Closing Summary — ${record.resolution?.replace('_', ' ')}`}>
          <p className="text-sm whitespace-pre-wrap">{record.summary}</p>
          <p className="mt-3 text-xs text-[var(--color-content-muted)]">
            Closed {formatDateTime(record.closedAt)}
            {record.slaBreached && (
              <span className="ml-2 text-[var(--color-severity-critical)]">SLA breached</span>
            )}
          </p>
        </Card>
      )}

      <div className="flex items-center gap-1 border-b border-[var(--color-border-subtle)]">
        {(
          [
            ['overview', 'Overview'],
            ['tasks', `Tasks (${record.taskCount})`],
            ['observables', `Observables (${record.observableCount})`],
            ['related', `Related cases (${record.relatedCount ?? 0})`],
            ['timeline', 'Timeline'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cx(
              '-mb-px border-b-2 px-4 py-2 text-sm',
              tab === key
                ? 'border-[var(--color-accent)] text-[var(--color-content)]'
                : 'border-transparent text-[var(--color-content-muted)] hover:text-[var(--color-content)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <CaseOverviewTab
          record={record}
          canEdit={canEdit}
          canAssignAnyone={canAssignAnyone}
          people={people.data?.items ?? []}
          onAssign={(userId) => assign.mutate(userId)}
          onSaved={refresh}
        />
      )}
      {tab === 'tasks' && (
        <CaseTasksTab caseId={record.id} readOnly={isClosed} people={people.data?.items ?? []} onChanged={refresh} />
      )}
      {tab === 'observables' && (
        <CaseObservablesTab caseId={record.id} readOnly={isClosed} onChanged={refresh} />
      )}
      {tab === 'related' && <CaseRelatedTab caseId={record.id} readOnly={isClosed} />}
      {tab === 'timeline' && <CaseTimelineTab caseId={record.id} />}
    </div>
  );
}
