/**
 * The period the dashboard's activity widgets count over.
 *
 * One choice for the whole board, so every figure on it answers the same
 * question — "in the last 24 hours" — and a SLA percentage is never read next
 * to a trend that covers a different fortnight. Widgets that show the current
 * state (open cases, workload, the deadline queue) do not take a period.
 */
export const DASHBOARD_RANGES = ['1h', '3h', '6h', '12h', '24h', '3d', '7d', '30d'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '24h';

export interface DashboardRangeSpec {
  /** How far back the period reaches. */
  minutes: number;
  /**
   * The width of one point on the trend chart: about a dozen points for the
   * short periods, a point per local hour for a day, a point per local day
   * from a week up.
   */
  bucketMinutes: number;
  /** "Last 24 hours" — shown on every card that follows the period. */
  label: string;
}

export const DASHBOARD_RANGE_SPECS: Record<DashboardRange, DashboardRangeSpec> = {
  '1h': { minutes: 60, bucketMinutes: 5, label: 'Last hour' },
  '3h': { minutes: 180, bucketMinutes: 15, label: 'Last 3 hours' },
  '6h': { minutes: 360, bucketMinutes: 30, label: 'Last 6 hours' },
  '12h': { minutes: 720, bucketMinutes: 60, label: 'Last 12 hours' },
  '24h': { minutes: 1440, bucketMinutes: 60, label: 'Last 24 hours' },
  '3d': { minutes: 4320, bucketMinutes: 360, label: 'Last 3 days' },
  '7d': { minutes: 10080, bucketMinutes: 1440, label: 'Last 7 days' },
  '30d': { minutes: 43200, bucketMinutes: 1440, label: 'Last 30 days' },
};

export function isDashboardRange(value: unknown): value is DashboardRange {
  return typeof value === 'string' && (DASHBOARD_RANGES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Trend buckets
// ---------------------------------------------------------------------------

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** How far a zone's wall clock is ahead of UTC at an instant, in milliseconds. */
export function zoneOffsetMs(timeZone: string, instant: number): number {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zoneFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - (instant - (((instant % 1000) + 1000) % 1000));
}

/** The instant a wall-clock time (written as if it were UTC) happens in a zone. */
function wallToInstant(wall: number, timeZone: string): number {
  const first = wall - zoneOffsetMs(timeZone, wall);
  return wall - zoneOffsetMs(timeZone, first);
}

export interface TrendBucket {
  start: number;
  end: number;
}

/**
 * The points of the trend chart, oldest first, the last one holding now.
 *
 * Aligned to the viewer's own clock — hours on the hour, six-hour points at
 * 00/06/12/18, days at local midnight — because that is how the chart is
 * read. The arithmetic runs on the wall clock and is converted per point, so
 * a daylight-saving change makes one day 23 or 25 hours long rather than
 * shifting every midnight after it.
 */
export function trendBuckets(
  period: Pick<DashboardRangeSpec, 'minutes' | 'bucketMinutes'>,
  timeZone: string,
  now = Date.now(),
): TrendBucket[] {
  const size = period.bucketMinutes * 60_000;
  const count = Math.max(1, Math.round(period.minutes / period.bucketMinutes));
  const current = Math.floor((now + zoneOffsetMs(timeZone, now)) / size) * size;
  const buckets: TrendBucket[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const wall = current - index * size;
    buckets.push({
      start: wallToInstant(wall, timeZone),
      end: wallToInstant(wall + size, timeZone),
    });
  }
  return buckets;
}

/** Which bucket an instant falls in, or -1 outside them all. */
export function bucketIndex(buckets: readonly TrendBucket[], instant: number): number {
  let low = 0;
  let high = buckets.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const bucket = buckets[middle]!;
    if (instant < bucket.start) high = middle - 1;
    else if (instant >= bucket.end) low = middle + 1;
    else return middle;
  }
  return -1;
}
