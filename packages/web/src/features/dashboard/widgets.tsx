import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  Bar,
  BarChart,
  ComposedChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DASHBOARD_RANGE_SPECS, type DashboardRange, type Severity } from '@black-ticket/shared';
import { api } from '@/lib/api';
import { EmptyState, Skeleton, cx } from '@/components/ui';
import { IconInbox } from '@/components/icons';
import { SeverityChip, formatRelativeDeadline } from '@/components/case-bits';

/**
 * Dashboard widgets.
 *
 * Two rules hold across all of them:
 *
 *  1. Colours come from the same CSS variables the rest of the app uses, so a
 *     CRITICAL bar is the same red as a CRITICAL chip in a table. Charts that
 *     invent their own palette make people read the legend every time.
 *  2. Every element that represents a set of records is a way into that set.
 *     A number on a dashboard that cannot be opened is a dead end — the analyst
 *     sees "7 breached" and then has to go and rebuild that filter by hand.
 */
const SEVERITY_COLOR: Record<string, string> = {
  LOW: 'var(--color-severity-low)',
  MEDIUM: 'var(--color-severity-medium)',
  HIGH: 'var(--color-severity-high)',
  CRITICAL: 'var(--color-severity-critical)',
};

const ALERT_STATUS_COLOR: Record<string, string> = {
  NEW: 'var(--color-accent)',
  TRIAGED: 'var(--color-severity-medium)',
  IMPORTED: 'var(--color-tlp-green)',
  IGNORED: 'var(--color-content-faint)',
};

const AXIS_PROPS = {
  stroke: 'var(--color-content-faint)',
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: 'var(--color-border-subtle)' },
} as const;

const TOOLTIP_STYLE = {
  cursor: { fill: 'var(--color-surface-hover)', opacity: 0.4 },
  contentStyle: {
    background: 'var(--color-surface-overlay)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: '8px',
    fontSize: '12px',
    boxShadow: 'var(--shadow-overlay)',
  },
  labelStyle: { color: 'var(--color-content)' },
} as const;

const OPEN_STATUSES = 'NEW,IN_PROGRESS,PENDING';

/**
 * Widgets refresh on their own, at the same pace as the tiles above them.
 * A dashboard is often left open on a wall screen, where nothing ever takes
 * focus; without this the charts froze at whatever they showed when the page
 * was opened, and drifted away from the tiles that did refresh.
 */
const REFRESH_MS = 60_000;

/**
 * Recharts hands a bar click the rendered rectangle, with the row it was drawn
 * from tucked inside `payload`. Unwrapping that once here keeps every widget's
 * click handler about navigation rather than about chart internals.
 */
type BarClickHandler = NonNullable<React.ComponentProps<typeof Bar>['onClick']>;
type PieClickHandler = NonNullable<React.ComponentProps<typeof Pie>['onClick']>;

function onBarClick<T extends object>(handler: (row: Partial<T>) => void): BarClickHandler {
  return ((data: unknown) => {
    handler(((data as { payload?: T })?.payload ?? {}) as Partial<T>);
  }) as BarClickHandler;
}

/** A pie slice carries the row directly rather than nested under `payload`. */
function onPieClick<T extends object>(handler: (row: Partial<T>) => void): PieClickHandler {
  return ((data: unknown) => {
    const record = data as { payload?: T };
    handler((record?.payload ?? (data as T) ?? {}) as Partial<T>);
  }) as PieClickHandler;
}

/**
 * A widget whose request failed.
 *
 * Deliberately not a skeleton: the old code returned the loading placeholder
 * whenever data was absent, so a failed request shimmered forever and the
 * dashboard looked busy rather than broken.
 */
function WidgetError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 py-6">
      <p className="text-sm text-[var(--color-severity-critical)]">Could not load this widget.</p>
      <button
        onClick={onRetry}
        className="text-xs text-[var(--color-content-muted)] underline hover:text-[var(--color-content)]"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Long enough for a real case title, short enough to keep the row together.
 *
 * A CSS truncation has to be given a width, and any width wide enough for the
 * longest title leaves every shorter one trailing whitespace before the next
 * column. Cutting the string instead lets the column size itself to what is
 * actually in it.
 */
const TITLE_LIMIT = 64;

function shorten(text: string, limit = TITLE_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="flex items-end gap-2"
      style={{ height }}
      role="status"
      aria-label="Loading chart"
    >
      {[60, 85, 45, 95, 70, 55, 80].map((value, index) => (
        <Skeleton key={index} className="flex-1" style={{ height: `${value}%` }} />
      ))}
    </div>
  );
}

/** "last 24 hours", for sentences such as "No alerts in the last 24 hours". */
function periodPhrase(range: DashboardRange): string {
  const label = DASHBOARD_RANGE_SPECS[range].label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Shown under every chart that can be drilled into. */
function DrillHint({ children }: { children: string }) {
  return <p className="mt-2 text-[11px] text-[var(--color-content-faint)]">{children}</p>;
}

// ---------------------------------------------------------------- widgets

/** The browser's zone, which is the one the person reading the chart lives in. */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const pad2 = (value: number) => String(value).padStart(2, '0');

/**
 * How a point of the trend reads: a day as `10-02`, a six-hour slot as
 * `10-02 06:00`, anything shorter as `14:00`. In the browser's zone, which is
 * the one the server bucketed in.
 */
function pointLabel(iso: string, bucketMinutes: number): string {
  const date = new Date(iso);
  const day = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (bucketMinutes >= 1440) return day;
  return bucketMinutes >= 360 ? `${day} ${time}` : time;
}

/** What one column of the trend is, for the hint under it. */
const POINT_NAME: Record<number, string> = {
  5: 'a five-minute slot',
  15: 'a quarter hour',
  30: 'a half hour',
  60: 'an hour',
  360: 'a six-hour slot',
  1440: 'a day',
};

function CaseTrend({ range }: { range: DashboardRange }) {
  const navigate = useNavigate();
  const data = useQuery({
    queryKey: ['metrics', 'case-trend', range, TIME_ZONE],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{
        bucketMinutes: number;
        items: { start: string; end: string; opened: number; closed: number }[];
      }>(`/metrics/case-trend?range=${range}&tz=${encodeURIComponent(TIME_ZONE)}`),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) return <ChartSkeleton height={220} />;

  const { bucketMinutes } = data.data;

  /*
   * Each day gets a faint full-height column behind the areas.
   *
   * A chart-level click handler would depend on Recharts working out which day
   * the pointer was nearest; a real element per day is an honest hit target —
   * it can be hovered, clicked, and reasoned about.
   */
  const ceiling = Math.max(
    1,
    ...data.data.items.map((point) => Math.max(point.opened, point.closed)),
  );
  const items = data.data.items.map((point) => ({
    ...point,
    label: pointLabel(point.start, bucketMinutes),
    span:
      bucketMinutes >= 1440
        ? pointLabel(point.start, bucketMinutes)
        : `${pointLabel(point.start, bucketMinutes)}–${pointLabel(point.end, 60)}`,
    column: ceiling,
  }));

  return (
    <>
      <ResponsiveContainer width="100%" height={220} className="chart-interactive">
        <ComposedChart data={items} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
            vertical={false}
          />
          <XAxis dataKey="label" minTickGap={12} {...AXIS_PROPS} />
          <YAxis allowDecimals={false} domain={[0, ceiling]} {...AXIS_PROPS} />
          <Tooltip
            {...TOOLTIP_STYLE}
            labelFormatter={(label, payload) =>
              (payload?.[0]?.payload as { span?: string } | undefined)?.span ?? String(label)
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            dataKey="column"
            name="Cases opened in that period"
            fill="var(--color-content)"
            fillOpacity={0.05}
            isAnimationActive={false}
            // A hit target is not a series; keeping it out of the legend stops
            // it from reading as data.
            legendType="none"
            tooltipType="none"
            // The trend counts when cases were opened, so the drill-down has to
            // filter on the same field or the row count will not match.
            // The point's own bounds, as the server counted them; `to` is the
            // last instant inside it, the way the list takes a window.
            onClick={onBarClick<{ start: string; end: string }>((row) => {
              if (row.start && row.end) {
                const query = new URLSearchParams({
                  status: 'all',
                  dateField: 'createdAt',
                  from: row.start,
                  to: new Date(new Date(row.end).getTime() - 1).toISOString(),
                });
                navigate(`/cases?${query.toString()}`);
              }
            })}
          />
          <Area
            type="monotone"
            dataKey="opened"
            name="Opened"
            stroke="var(--color-accent)"
            fill="var(--color-accent)"
            fillOpacity={0.2}
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="closed"
            name="Closed"
            stroke="var(--color-tlp-green)"
            fill="var(--color-tlp-green)"
            fillOpacity={0.14}
            strokeWidth={2}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <DrillHint>
        {`Click ${POINT_NAME[bucketMinutes] ?? 'a column'} to list the cases opened in it.`}
      </DrillHint>
    </>
  );
}

function OpenBySeverity() {
  const navigate = useNavigate();
  const data = useQuery({
    queryKey: ['metrics', 'open-by-severity'],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{ items: { severity: string; count: number }[] }>('/metrics/open-by-severity'),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) return <ChartSkeleton height={220} />;

  const items = data.data.items.filter((entry) => entry.count > 0);
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconInbox className="h-8 w-8" />}
        title="No open cases"
        description="Nothing is waiting on the team right now."
      />
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={220} className="chart-interactive">
        <PieChart>
          <Pie
            data={items}
            dataKey="count"
            nameKey="severity"
            innerRadius={52}
            outerRadius={82}
            paddingAngle={2}
            onClick={onPieClick<{ severity: string }>((row) => {
              if (row.severity) navigate(`/cases?status=open&severity=${row.severity}`);
            })}
          >
            {items.map((entry) => (
              <Cell
                key={entry.severity}
                fill={SEVERITY_COLOR[entry.severity]}
                stroke="var(--color-surface-raised)"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <DrillHint>Click a slice to list those cases.</DrillHint>
    </>
  );
}

function SlaCompliance({ range }: { range: DashboardRange }) {
  const data = useQuery({
    queryKey: ['metrics', 'sla', range],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{
        since: string;
        closed: number;
        onTime: number;
        breached: number;
        openBreached: number;
        compliance: number | null;
      }>(`/metrics/sla?range=${range}`),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) {
    return (
      <div className="space-y-3 py-4">
        <Skeleton className="mx-auto h-10 w-24" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }

  const { since, compliance, onTime, breached, openBreached, closed } = data.data;

  // Same window, same instant as the figures: the lists have to add up to them.
  const closedSince = `status=CLOSED&dateField=closedAt&from=${encodeURIComponent(since)}`;
  const rows: { label: string; value: number; to: string; tone?: string }[] = [
    { label: 'Closed on time', value: onTime, to: `/cases?${closedSince}&breached=false` },
    {
      label: 'Closed after breach',
      value: breached,
      to: `/cases?${closedSince}&breached=true`,
      tone: 'text-[var(--color-severity-critical)]',
    },
    {
      // The state of the queue now; no period applies to it.
      label: 'Open and overdue now',
      value: openBreached,
      to: `/cases?status=${OPEN_STATUSES}&breached=true`,
      tone: openBreached > 0 ? 'text-[var(--color-severity-critical)]' : undefined,
    },
  ];

  return (
    <div className="flex h-full flex-col justify-center gap-4 py-2">
      <div className="text-center">
        <p
          className={cx(
            'text-4xl font-semibold tabular-nums',
            compliance === null
              ? 'text-[var(--color-content-faint)]'
              : compliance >= 90
                ? 'text-[var(--color-tlp-green)]'
                : compliance >= 70
                  ? 'text-[var(--color-severity-medium)]'
                  : 'text-[var(--color-severity-critical)]',
          )}
        >
          {compliance === null ? '—' : `${compliance}%`}
        </p>
        <p className="mt-1 text-xs text-[var(--color-content-muted)]">
          of {closed} case(s) closed within target, {periodPhrase(range)}
        </p>
      </div>

      <dl className="space-y-1 border-t border-[var(--color-border-subtle)] pt-3 text-sm">
        {rows.map((row) => (
          <Link
            key={row.label}
            to={row.to}
            className="flex items-center justify-between rounded px-1.5 py-1 transition-colors hover:bg-[var(--color-surface-overlay)]"
          >
            <dt className="text-[var(--color-content-muted)]">{row.label}</dt>
            <dd className={cx('tabular-nums', row.tone)}>{row.value}</dd>
          </Link>
        ))}
      </dl>
    </div>
  );
}

function ResolutionTime({ range }: { range: DashboardRange }) {
  const navigate = useNavigate();
  const data = useQuery({
    queryKey: ['metrics', 'resolution-time', range],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{
        since: string;
        items: { severity: string; hours: number | null; cases: number }[];
      }>(`/metrics/resolution-time?range=${range}`),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) return <ChartSkeleton height={220} />;

  const items = data.data.items.filter((entry) => entry.hours !== null);
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing closed"
        description={`No cases were closed in the ${periodPhrase(range)}.`}
      />
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={220} className="chart-interactive">
        <BarChart data={items} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
            vertical={false}
          />
          <XAxis dataKey="severity" {...AXIS_PROPS} />
          <YAxis unit="h" {...AXIS_PROPS} />
          <Tooltip
            {...TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--color-content)' }}
            formatter={(value) => [`${String(value)} h`, 'Mean Time To Close']}
          />
          <Bar
            dataKey="hours"
            radius={[4, 4, 0, 0]}
            onClick={onBarClick<{ severity: string }>((row) => {
              if (!row.severity) return;
              const since = encodeURIComponent(data.data.since);
              navigate(
                `/cases?status=CLOSED&severity=${row.severity}&dateField=closedAt&from=${since}`,
              );
            })}
          >
            {items.map((entry) => (
              <Cell key={entry.severity} fill={SEVERITY_COLOR[entry.severity]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <DrillHint>Click a bar to list the closed cases behind the average.</DrillHint>
    </>
  );
}

function Workload() {
  const navigate = useNavigate();
  const data = useQuery({
    queryKey: ['metrics', 'workload'],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{ items: { id: string | null; name: string; count: number }[] }>('/metrics/workload'),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) return <ChartSkeleton height={200} />;
  if (data.data.items.length === 0) {
    return <EmptyState icon={<IconInbox className="h-8 w-8" />} title="No open cases" />;
  }

  return (
    <>
      <ResponsiveContainer
        width="100%"
        height={Math.max(180, data.data.items.length * 34)}
        className="chart-interactive"
      >
        <BarChart
          data={data.data.items}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 0, left: 12 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
            horizontal={false}
          />
          <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
          <YAxis type="category" dataKey="name" width={120} {...AXIS_PROPS} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar
            dataKey="count"
            name="Open cases"
            fill="var(--color-accent)"
            radius={[0, 4, 4, 0]}
            onClick={onBarClick<{ id: string | null }>((row) => {
              navigate(
                row.id
                  ? `/cases?status=open&assigneeId=${row.id}`
                  : '/cases?status=open&unassigned=true',
              );
            })}
          />
        </BarChart>
      </ResponsiveContainer>
      <DrillHint>Click a bar to see that analyst's open cases.</DrillHint>
    </>
  );
}

function AlertsByStatus({ range }: { range: DashboardRange }) {
  const navigate = useNavigate();
  const data = useQuery({
    queryKey: ['metrics', 'alerts-by-status', range],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{ since: string; items: { status: string; count: number }[] }>(
        `/metrics/alerts-by-status?range=${range}`,
      ),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) return <ChartSkeleton />;
  if (data.data.items.length === 0) {
    return (
      <EmptyState
        icon={<IconInbox className="h-8 w-8" />}
        title={`No alerts received in the ${periodPhrase(range)}`}
        description="Choose a longer period, or point a SIEM at the ingest endpoint."
      />
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={200} className="chart-interactive">
        <BarChart data={data.data.items} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
            vertical={false}
          />
          <XAxis dataKey="status" {...AXIS_PROPS} />
          <YAxis allowDecimals={false} {...AXIS_PROPS} />
          <Tooltip {...TOOLTIP_STYLE} itemStyle={{ color: 'var(--color-severity-critical)' }} />
          <Bar
            dataKey="count"
            name="Alerts"
            radius={[4, 4, 0, 0]}
            onClick={onBarClick<{ status: string }>((row) => {
              if (!row.status) return;
              const query = new URLSearchParams({ status: row.status, from: data.data.since });
              navigate(`/alerts?${query.toString()}`);
            })}
          >
            {data.data.items.map((entry) => (
              <Cell
                key={entry.status}
                fill={ALERT_STATUS_COLOR[entry.status] ?? 'var(--color-accent)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <DrillHint>Click a bar to open that part of the queue.</DrillHint>
    </>
  );
}

function AlertsBySource({ range }: { range: DashboardRange }) {
  const navigate = useNavigate();
  const data = useQuery({
    queryKey: ['metrics', 'alerts-by-source', range],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{ since: string; items: { source: string; count: number }[] }>(
        `/metrics/alerts-by-source?range=${range}`,
      ),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) return <ChartSkeleton height={180} />;
  if (data.data.items.length === 0) {
    return <EmptyState title={`No alerts in the ${periodPhrase(range)}`} />;
  }

  return (
    <>
      <ResponsiveContainer
        width="100%"
        height={Math.max(160, data.data.items.length * 36)}
        className="chart-interactive"
      >
        <BarChart
          data={data.data.items}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 0, left: 12 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
            horizontal={false}
          />
          <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
          <YAxis type="category" dataKey="source" width={110} {...AXIS_PROPS} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar
            dataKey="count"
            name="Alerts"
            fill="var(--color-tlp-green)"
            radius={[0, 4, 4, 0]}
            onClick={onBarClick<{ source: string }>((row) => {
              if (!row.source) return;
              const query = new URLSearchParams({
                status: 'all',
                source: row.source,
                from: data.data.since,
              });
              navigate(`/alerts?${query.toString()}`);
            })}
          />
        </BarChart>
      </ResponsiveContainer>
      <DrillHint>Click a bar to filter the queue by source.</DrillHint>
    </>
  );
}

function TopTags({ range }: { range: DashboardRange }) {
  const data = useQuery({
    queryKey: ['metrics', 'top-tags', range],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{ since: string; items: { tag: string; count: number }[] }>(
        `/metrics/top-tags?limit=8&range=${range}`,
      ),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) {
    return (
      <div className="space-y-2.5 py-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-4" />
        ))}
      </div>
    );
  }

  if (data.data.items.length === 0) {
    return <EmptyState title={`No tagged cases opened in the ${periodPhrase(range)}`} />;
  }
  const openedSince = `status=all&dateField=createdAt&from=${encodeURIComponent(data.data.since)}`;
  const max = Math.max(...data.data.items.map((entry) => entry.count));

  return (
    <ul className="space-y-1.5 py-1">
      {data.data.items.map((entry) => (
        <li key={entry.tag}>
          <Link
            to={`/cases?${openedSince}&tag=${encodeURIComponent(entry.tag)}`}
            className="flex items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors hover:bg-[var(--color-surface-overlay)]"
          >
            <span className="w-36 truncate">{entry.tag}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-overlay)]">
              <span
                className="block h-full rounded-full bg-[var(--color-accent)] transition-all"
                style={{ width: `${(entry.count / max) * 100}%` }}
              />
            </span>
            <span className="w-8 text-right text-xs tabular-nums text-[var(--color-content-muted)]">
              {entry.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TopObservables({ range }: { range: DashboardRange }) {
  const data = useQuery({
    queryKey: ['metrics', 'top-observables', range],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{
        items: { id: string; type: string; value: string; sightings: number; isNoisy: boolean }[];
      }>(`/metrics/top-observables?limit=8&range=${range}`),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) {
    return (
      <div className="space-y-2.5 py-1">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-4" />
        ))}
      </div>
    );
  }

  if (data.data.items.length === 0) {
    return (
      <EmptyState
        title={`Nothing seen twice in the ${periodPhrase(range)}`}
        description="Indicators appear here once they show up on more than one case opened in the period."
      />
    );
  }

  return (
    <ul className="space-y-1 py-1 text-sm">
      {data.data.items.map((entry) => (
        <li key={entry.id}>
          <Link
            to={`/observables?q=${encodeURIComponent(entry.value)}`}
            className="flex items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-[var(--color-surface-overlay)]"
          >
            <span className="w-24 shrink-0 text-xs text-[var(--color-content-faint)]">
              {entry.type}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.value}</span>
            {entry.isNoisy && (
              <span className="text-[10px] tracking-wide text-[var(--color-severity-medium)] uppercase">
                noisy
              </span>
            )}
            <span className="w-16 text-right text-xs tabular-nums text-[var(--color-accent)]">
              {entry.sightings} cases
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DueSoon() {
  const data = useQuery({
    queryKey: ['metrics', 'due-soon'],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{
        items: {
          id: string;
          reference: string;
          title: string;
          severity: Severity;
          status: string;
          slaDueAt: string | null;
          assignee: string | null;
        }[];
      }>('/metrics/due-soon?limit=8'),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-5" />
        ))}
      </div>
    );
  }

  if (data.data.items.length === 0) {
    return (
      <EmptyState
        icon={<IconInbox className="h-8 w-8" />}
        title="Nothing open"
        description="Quiet shift."
      />
    );
  }

  return (
    /*
     * Column positions are proportional, and only from `xl` up: the spacing
     * that reads well across a wide dashboard puts the deadline off the edge of
     * a narrow one. Below that the columns fall back to sizing themselves.
     *
     * The widget can also be resized to half width, where a row of nowrap
     * columns no longer fits; it scrolls rather than bursting out of its card.
     */
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <tbody>
          {data.data.items.map((row) => {
            const sla = formatRelativeDeadline(row.slaDueAt, false);
            return (
              <tr
                key={row.id}
                className="group border-t border-[var(--color-border-subtle)] first:border-t-0"
              >
                <td className="py-1.5 pr-8 font-mono text-xs whitespace-nowrap xl:w-[20.5%] xl:pr-2">
                  <Link to={`/cases/${row.id}`} className="hover:text-[var(--color-accent)]">
                    {row.reference}
                  </Link>
                </td>
                <td className="min-w-[28rem] py-1.5 pr-8 whitespace-nowrap xl:w-[63%] xl:min-w-0 xl:pr-2">
                  <Link
                    to={`/cases/${row.id}`}
                    title={row.title}
                    className="group-hover:text-[var(--color-accent)]"
                  >
                    {shorten(row.title)}
                  </Link>
                </td>
                <td className="py-1.5 pr-8 xl:w-[10.5%] xl:pr-2">
                  <SeverityChip value={row.severity} />
                </td>
                <td className="w-full py-1.5 pr-2 text-xs whitespace-nowrap text-[var(--color-content-muted)]">
                  {row.assignee ?? 'unassigned'}
                </td>
                <td
                  className={cx(
                    'py-1.5 text-right text-xs whitespace-nowrap tabular-nums',
                    sla.overdue
                      ? 'text-[var(--color-severity-critical)]'
                      : 'text-[var(--color-content-muted)]',
                  )}
                >
                  {sla.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MitreCoverage({ range }: { range: DashboardRange }) {
  const data = useQuery({
    queryKey: ['metrics', 'mitre', range],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      api.get<{
        since: string;
        items: { id: string; name: string; tactic: string; count: number }[];
      }>(`/metrics/mitre-coverage?limit=8&range=${range}`),
  });

  if (data.isError) return <WidgetError onRetry={() => void data.refetch()} />;
  if (!data.data) {
    return (
      <div className="space-y-2.5 py-1">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-4" />
        ))}
      </div>
    );
  }

  if (data.data.items.length === 0) {
    return (
      <EmptyState title={`No techniques tagged on cases opened in the ${periodPhrase(range)}`} />
    );
  }
  const openedSince = `status=all&dateField=createdAt&from=${encodeURIComponent(data.data.since)}`;

  return (
    <ul className="space-y-1 py-1 text-sm">
      {data.data.items.map((entry) => (
        <li key={entry.id}>
          <Link
            to={`/cases?${openedSince}&mitre=${entry.id}`}
            className="flex items-baseline gap-2 rounded px-1.5 py-1 transition-colors hover:bg-[var(--color-surface-overlay)]"
          >
            <span className="w-20 shrink-0 font-mono text-xs">{entry.id}</span>
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <span className="hidden text-xs text-[var(--color-content-faint)] sm:inline">
              {entry.tactic}
            </span>
            <span className="w-8 text-right text-xs tabular-nums text-[var(--color-accent)]">
              {entry.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface WidgetDefinition {
  id: string;
  title: string;
  description: string;
  defaultWidth: 'half' | 'full';
  /**
   * `period`: counts over the period chosen for the dashboard. `now`: the
   * current state of the queue, which no period changes — an open case is
   * open whenever it was opened.
   */
  scope: 'period' | 'now';
  render: (range: DashboardRange) => React.ReactNode;
}

export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'due-soon',
    title: 'Next Up — By Deadline',
    description: 'Open cases ordered by how soon they breach',
    defaultWidth: 'full',
    scope: 'now',
    render: () => <DueSoon />,
  },
  {
    id: 'case-trend',
    title: 'Opened Vs Closed',
    description: 'Cases opened and closed across the period',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <CaseTrend range={range} />,
  },
  {
    id: 'open-by-severity',
    title: 'Open By Severity',
    description: 'Where the open work sits',
    defaultWidth: 'half',
    scope: 'now',
    render: () => <OpenBySeverity />,
  },
  {
    id: 'sla',
    title: 'SLA Compliance',
    description: 'Share of cases closed inside target in the period',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <SlaCompliance range={range} />,
  },
  {
    id: 'resolution-time',
    title: 'Mean Time To Close',
    description: 'Hours from incident to closure, per severity, for cases closed in the period',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <ResolutionTime range={range} />,
  },
  {
    id: 'workload',
    title: 'Analyst Workload',
    description: 'Open cases per analyst, unassigned included',
    defaultWidth: 'half',
    scope: 'now',
    render: () => <Workload />,
  },
  {
    id: 'alerts-by-status',
    title: 'Alert Queue',
    description: 'Alerts received in the period: waiting, imported and dismissed',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <AlertsByStatus range={range} />,
  },
  {
    id: 'alerts-by-source',
    title: 'Alerts By Source',
    description: 'Which system is sending the volume',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <AlertsBySource range={range} />,
  },
  {
    id: 'top-tags',
    title: 'Most Used Tags',
    description: 'What the team is actually seeing, on cases opened in the period',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <TopTags range={range} />,
  },
  {
    id: 'top-observables',
    title: 'Recurring Indicators',
    description: 'Indicators appearing on several cases opened in the period',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <TopObservables range={range} />,
  },
  {
    id: 'mitre-coverage',
    title: 'ATT&CK Coverage',
    description: 'Techniques tagged most often on cases opened in the period',
    defaultWidth: 'half',
    scope: 'period',
    render: (range) => <MitreCoverage range={range} />,
  },
];

export const DEFAULT_LAYOUT: { id: string; width: 'half' | 'full' }[] = [
  { id: 'due-soon', width: 'full' },
  { id: 'case-trend', width: 'half' },
  { id: 'open-by-severity', width: 'half' },
  { id: 'sla', width: 'half' },
  { id: 'alerts-by-status', width: 'half' },
];
