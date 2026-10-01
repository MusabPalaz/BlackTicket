import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_SPECS,
  DEFAULT_DASHBOARD_RANGE,
  Permission,
  isDashboardRange,
  type DashboardRange,
} from '@black-ticket/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { usePreferences, useSavePreferences } from '@/lib/preferences';
import { Button, PageHeader, StatTile, cx } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DEFAULT_LAYOUT, WIDGETS, type WidgetDefinition } from './widgets';
import type { CaseSummaryCounters } from '@/features/cases/types';
import type { AlertSummary } from '@/features/alerts/types';

interface LayoutEntry {
  id: string;
  width: 'half' | 'full';
}

/**
 * The layout the account has on file, or the default when it has none.
 *
 * An empty list is a real choice — someone who cleared the board wants an empty
 * board — so it is honoured. A list that no longer names a single widget the
 * product still ships is not a choice, it is a stale record, and falls back.
 */
function storedLayout(saved: LayoutEntry[] | undefined): LayoutEntry[] {
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT;
  const known = saved.filter((entry) => WIDGETS.some((widget) => widget.id === entry.id));
  return saved.length > 0 && known.length === 0 ? DEFAULT_LAYOUT : known;
}

/** The period picker: short labels in one row, the full one on hover. */
function RangePicker({
  value,
  onChange,
}: {
  value: DashboardRange;
  onChange: (next: DashboardRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex flex-wrap items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-0.5"
    >
      {DASHBOARD_RANGES.map((range) => {
        const on = range === value;
        return (
          <button
            key={range}
            type="button"
            aria-pressed={on}
            aria-label={DASHBOARD_RANGE_SPECS[range].label}
            title={DASHBOARD_RANGE_SPECS[range].label}
            onClick={() => onChange(range)}
            className={cx(
              'rounded px-2.5 py-1.5 text-xs font-medium tabular-nums transition-colors',
              on
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-content)]',
            )}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}

/** What a card counts over: the chosen period, or the queue as it stands. */
function PeriodChip({ scope, range }: { scope: WidgetDefinition['scope']; range: DashboardRange }) {
  const now = scope === 'now';
  return (
    <span
      title={
        now
          ? 'The queue as it stands; the time range does not change it'
          : 'Follows the time range chosen at the top'
      }
      className={cx(
        'rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap',
        now
          ? 'border-[var(--color-border-subtle)] text-[var(--color-content-faint)]'
          : 'border-[var(--color-border-strong)] text-[var(--color-accent)]',
      )}
    >
      {now ? 'Now' : DASHBOARD_RANGE_SPECS[range].label}
    </span>
  );
}

/**
 * The dashboard is arranged by whoever is looking at it.
 *
 * A SOC lead watches SLA compliance and workload; an analyst watches their own
 * queue. Rather than guess, the layout is per-user and saved on the account, so
 * it follows people between machines and shifts.
 */
export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const hasPermission = useAuthStore((state) => state.hasPermission);

  const toast = useToast();
  const confirm = useConfirm();
  /** Unsaved local arrangement. Null means "whatever the account has on file". */
  const [draft, setDraft] = useState<LayoutEntry[] | null>(null);
  const [editing, setEditing] = useState(false);

  const preferences = usePreferences();

  // Derived rather than mirrored into state by an effect. A mirror starts life
  // holding the default, so every remount showed the default until the query
  // happened to refetch — which, at a 30s stale time, is exactly the window in
  // which someone checks whether their save took.
  const stored = useMemo(
    () => storedLayout(preferences.data?.preferences?.dashboard?.widgets),
    [preferences.data],
  );
  const layout = draft ?? stored;

  const savePreferences = useSavePreferences();

  /*
   * The period the activity widgets count over. Saved on the account like the
   * layout, so a wall screen left on "last 24 hours" comes back to it. A pick
   * applies at once, without waiting for the save.
   */
  const [rangeChoice, setRangeChoice] = useState<DashboardRange | null>(null);
  const savedRange = preferences.data?.preferences?.dashboardRange;
  const range =
    rangeChoice ?? (isDashboardRange(savedRange) ? savedRange : DEFAULT_DASHBOARD_RANGE);
  const saveRange = useSavePreferences();

  function chooseRange(next: DashboardRange) {
    setRangeChoice(next);
    saveRange.mutate({ dashboardRange: next });
  }

  function saveLayout(next: LayoutEntry[]) {
    savePreferences.mutate(
      { dashboard: { widgets: next } },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success('Layout saved', 'It follows your account to any machine.');
        },
      },
    );
  }

  const counters = useQuery({
    queryKey: ['case-summary'],
    queryFn: () => api.get<CaseSummaryCounters>('/cases/summary'),
    refetchInterval: 60_000,
  });

  const operations = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => api.get<AlertSummary>('/alerts/summary'),
    refetchInterval: 60_000,
    enabled: hasPermission(Permission.ALERT_READ),
  });

  function update(next: LayoutEntry[]) {
    setDraft(next);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= layout.length) return;
    const next = [...layout];
    const [entry] = next.splice(index, 1);
    next.splice(target, 0, entry!);
    update(next);
  }

  const available = WIDGETS.filter((widget) => !layout.some((entry) => entry.id === widget.id));

  const tiles = [
    { label: 'Open Cases', value: counters.data?.open, to: '/cases?status=open', urgent: false },
    {
      label: 'Assigned To Me',
      value: counters.data?.mine,
      to: `/cases?status=open&assigneeId=${user?.id ?? ''}`,
      urgent: false,
    },
    {
      label: 'Alerts Waiting',
      value: operations.data?.alerts?.NEW,
      to: '/alerts',
      urgent: (operations.data?.alerts?.NEW ?? 0) > 10,
    },
    {
      label: 'SLA Breached',
      value: operations.data?.sla?.breached,
      to: '/cases?status=open&breached=true',
      urgent: (operations.data?.sla?.breached ?? 0) > 0,
    },
  ];

  return (
    <div className="space-y-5 p-8">
      <PageHeader
        title="Dashboard"
        description={
          editing
            ? 'Add, remove and reorder your widgets. Every chart is a way into the cases behind it.'
            : `Signed in as ${user?.fullName}.`
        }
        actions={
          <>
            <RangePicker value={range} onChange={chooseRange} />
            {editing && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Reset your dashboard?',
                    body: <p>Your widgets, their order and their widths go back to the default.</p>,
                    confirmLabel: 'Reset dashboard',
                  });
                  if (!ok) return;
                  update(DEFAULT_LAYOUT);
                  saveLayout(DEFAULT_LAYOUT);
                }}
              >
                Reset to default
              </Button>
            )}
            <Button
              variant={editing ? 'primary' : 'secondary'}
              loading={savePreferences.isPending}
              onClick={() => {
                if (editing) saveLayout(layout);
                setEditing(!editing);
              }}
            >
              {editing ? 'Done' : 'Edit dashboard'}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            to={tile.to}
            className={cx(
              'rounded-[var(--radius-panel)] border bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--color-accent)]',
              tile.urgent
                ? 'border-[var(--color-severity-critical)]'
                : 'border-[var(--color-border-subtle)]',
            )}
          >
            <StatTile
              label={tile.label}
              value={tile.value ?? '—'}
              tone={tile.urgent ? 'urgent' : 'neutral'}
            />
          </Link>
        ))}
      </div>

      {editing && available.length > 0 && (
        <section className="rounded-lg border border-dashed border-[var(--color-border-subtle)] p-4">
          <p className="mb-3 text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
            Add a widget
          </p>
          <div className="flex flex-wrap gap-2">
            {available.map((widget) => (
              <button
                key={widget.id}
                onClick={() => update([...layout, { id: widget.id, width: widget.defaultWidth }])}
                title={widget.description}
                className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                + {widget.title}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {layout.map((entry, index) => {
          const widget = WIDGETS.find((item) => item.id === entry.id) as
            WidgetDefinition | undefined;
          if (!widget) return null;

          return (
            <section
              key={entry.id}
              className={cx(
                'rounded-[var(--radius-panel)] border bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]',
                entry.width === 'full' && 'lg:col-span-2',
                editing
                  ? 'border-dashed border-[var(--color-accent)]'
                  : 'border-[var(--color-border-subtle)]',
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium">{widget.title}</h2>
                  {editing && (
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {widget.description}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <PeriodChip scope={widget.scope} range={range} />
                  {editing && (
                    <div className="flex shrink-0 items-center gap-1 text-xs">
                      <button
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        title="Move up"
                        className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(index, 1)}
                        disabled={index === layout.length - 1}
                        title="Move down"
                        className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() =>
                          update(
                            layout.map((item, position) =>
                              position === index
                                ? { ...item, width: item.width === 'full' ? 'half' : 'full' }
                                : item,
                            ),
                          )
                        }
                        title="Toggle width"
                        className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5"
                      >
                        {entry.width === 'full' ? 'full' : 'half'}
                      </button>
                      <button
                        onClick={() => update(layout.filter((_, position) => position !== index))}
                        title="Remove"
                        className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[var(--color-severity-critical)]"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* One widget that throws must not take the other ten with it. */}
              <ErrorBoundary
                fallback={(reset) => (
                  <div role="alert" className="flex flex-col items-start gap-2 py-6">
                    <p className="text-sm text-[var(--color-severity-critical)]">
                      This widget failed to render.
                    </p>
                    <button
                      onClick={reset}
                      className="text-xs text-[var(--color-content-muted)] underline hover:text-[var(--color-content)]"
                    >
                      Try again
                    </button>
                  </div>
                )}
              >
                {widget.render(range)}
              </ErrorBoundary>
            </section>
          );
        })}
      </div>

      {layout.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] p-10 text-center">
          <p className="text-sm text-[var(--color-content-muted)]">
            No widgets. Use “Edit dashboard” to add some.
          </p>
        </div>
      )}
    </div>
  );
}
