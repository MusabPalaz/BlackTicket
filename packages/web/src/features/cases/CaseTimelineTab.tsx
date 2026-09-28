import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, EmptyState, Skeleton, cx } from '@/components/ui';
import { IconAudit } from '@/components/icons';
import type { TimelineEvent } from './types';

/**
 * The activity record: who did what, and when.
 *
 * Deliberately not a second copy of the investigation. Answers to the
 * playbook questions live on their task, in one place; this feed says that an
 * answer was written, by whom — the account of the work, not the work itself.
 */
const ACTION_PHRASE: Record<string, string> = {
  CREATE: 'opened the case',
  UPDATE: 'updated the case',
  ASSIGN: 'changed the assignment',
  CLOSE: 'closed the case',
  REOPEN: 'reopened the case',
  DELETE: 'deleted the case',
  LINK_CREATED: 'linked another case',
  LINK_REMOVED: 'removed a link',
  ALERT_IMPORTED: 'imported an alert',
  TASK_CREATED: 'added a task',
  TASK_LOG: 'answered',
};

const KIND_ACCENT: Record<TimelineEvent['kind'], string> = {
  note: 'bg-[var(--color-tlp-green)]',
  task: 'bg-[var(--color-accent)]',
  audit: 'bg-[var(--color-border-strong)]',
};

/** Renders the diff an audit entry carries, e.g. `severity HIGH -> CRITICAL`. */
function describeChange(event: TimelineEvent): string | null {
  const before = (event.before ?? {}) as Record<string, unknown>;
  const after = (event.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  const format = (value: unknown) =>
    value === null || value === undefined
      ? 'none'
      : Array.isArray(value)
        ? value.join(', ') || 'none'
        : String(value);

  const parts = keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${key}: ${format(before[key])} → ${format(after[key])}`);

  return parts.length ? parts.join(' · ') : null;
}

interface FeedEntry {
  event: TimelineEvent;
  /** Titles folded into this entry when several arrived together. */
  merged: string[];
}

/**
 * Folds a burst of identical actions into one line.
 *
 * Applying a playbook adds a dozen tasks in the same second; listed one per
 * row they bury the rest of the case's history under a wall of "added a task".
 * The detail is not lost — the titles are still named, just on one line.
 */
function collapse(events: TimelineEvent[]): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const event of events) {
    const previous = entries[entries.length - 1];
    const sameBurst =
      previous &&
      previous.event.action === event.action &&
      previous.event.actor?.id === event.actor?.id &&
      Math.abs(new Date(previous.event.at).getTime() - new Date(event.at).getTime()) < 60_000;

    if (sameBurst && event.title) {
      previous.merged.push(event.title);
    } else {
      entries.push({ event, merged: event.title ? [event.title] : [] });
    }
  }

  return entries;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function CaseTimelineTab({ caseId }: { caseId: string }) {
  const timeline = useQuery({
    queryKey: ['case-timeline', caseId],
    queryFn: () => api.get<{ items: TimelineEvent[] }>(`/cases/${caseId}/timeline`),
  });

  if (timeline.isLoading) {
    return (
      <Card>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-5" />
          ))}
        </div>
      </Card>
    );
  }

  const items = timeline.data?.items ?? [];
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={<IconAudit className="h-8 w-8" />} title="Nothing recorded yet" />
      </Card>
    );
  }

  // Grouped by day: a case worked over a week is easier to read as days than
  // as forty timestamps in a column.
  const days = new Map<string, TimelineEvent[]>();
  for (const event of items) {
    const key = dayLabel(event.at);
    days.set(key, [...(days.get(key) ?? []), event]);
  }

  return (
    <Card title="Activity" description="Who did what on this case. Answers live on their task.">
      <div className="space-y-6">
        {[...days.entries()].map(([day, events]) => (
          <section key={day}>
            <h3 className="mb-3 text-xs font-medium tracking-wide text-[var(--color-content-faint)] uppercase">
              {day}
            </h3>

            <ol className="space-y-3">
              {collapse(events).map(({ event, merged }, index) => {
                const change = event.kind === 'audit' ? describeChange(event) : null;
                const count = merged.length;
                return (
                  <li key={`${event.at}-${index}`} className="flex gap-3 text-sm">
                    <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-[var(--color-content-faint)]">
                      {new Date(event.at).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>

                    <span className="relative flex w-3 shrink-0 justify-center">
                      <span className="absolute top-4 bottom-[-14px] w-px bg-[var(--color-border-subtle)] last:hidden" />
                      <span className={cx('mt-1.5 h-2 w-2 rounded-full', KIND_ACCENT[event.kind])} />
                    </span>

                    <div className="min-w-0 flex-1 pb-1">
                      <p>
                        <span className="font-medium">{event.actor?.fullName ?? 'system'}</span>{' '}
                        <span className="text-[var(--color-content-muted)]">
                          {count > 1 && event.action === 'TASK_CREATED'
                            ? `added ${count} tasks`
                            : (ACTION_PHRASE[event.action] ??
                              event.action.toLowerCase().replace(/_/g, ' '))}
                        </span>
                        {count === 1 && event.title && (
                          <span className="text-[var(--color-content-muted)]"> — {event.title}</span>
                        )}
                      </p>
                      {count > 1 && (
                        <p className="mt-0.5 text-xs text-[var(--color-content-faint)]">
                          {merged.slice(0, 4).join(', ')}
                          {merged.length > 4 && ` and ${merged.length - 4} more`}
                        </p>
                      )}
                      {change && (
                        <p className="mt-0.5 font-mono text-xs text-[var(--color-content-faint)]">{change}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </Card>
  );
}
