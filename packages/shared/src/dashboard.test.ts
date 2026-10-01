import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_SPECS,
  bucketIndex,
  isDashboardRange,
  trendBuckets,
  zoneOffsetMs,
} from './dashboard';

const HOUR = 3_600_000;

/** The wall-clock time of an instant in a zone, as "YYYY-MM-DD HH:mm". */
function wall(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

describe('dashboard periods', () => {
  it('knows its own periods and nothing else', () => {
    expect(DASHBOARD_RANGES.every(isDashboardRange)).toBe(true);
    expect(isDashboardRange('2h')).toBe(false);
    expect(isDashboardRange(undefined)).toBe(false);
  });

  it('gives every period a whole number of trend points', () => {
    for (const range of DASHBOARD_RANGES) {
      const spec = DASHBOARD_RANGE_SPECS[range];
      expect(spec.minutes % spec.bucketMinutes).toBe(0);
    }
  });
});

describe('zone offsets', () => {
  it('reads a fixed offset and a daylight-saving one', () => {
    const instant = Date.UTC(2026, 6, 1, 12);
    expect(zoneOffsetMs('UTC', instant)).toBe(0);
    expect(zoneOffsetMs('Europe/Istanbul', instant)).toBe(3 * HOUR);
    expect(zoneOffsetMs('Asia/Kolkata', instant)).toBe(5.5 * HOUR);
    expect(zoneOffsetMs('Europe/Berlin', instant)).toBe(2 * HOUR);
    expect(zoneOffsetMs('Europe/Berlin', Date.UTC(2026, 11, 1, 12))).toBe(1 * HOUR);
  });
});

describe('trend buckets', () => {
  const now = Date.UTC(2026, 9, 2, 14, 37, 12); // 17:37 in Istanbul

  it('splits the last 24 hours into local hours, the last one holding now', () => {
    const buckets = trendBuckets(DASHBOARD_RANGE_SPECS['24h'], 'Europe/Istanbul', now);
    expect(buckets).toHaveLength(24);
    expect(wall(buckets.at(-1)!.start, 'Europe/Istanbul')).toBe('2026-10-02 17:00');
    expect(wall(buckets[0]!.start, 'Europe/Istanbul')).toBe('2026-10-01 18:00');
    expect(bucketIndex(buckets, now)).toBe(23);
  });

  it('aligns hours to the local clock in a half-hour zone', () => {
    const buckets = trendBuckets(DASHBOARD_RANGE_SPECS['12h'], 'Asia/Kolkata', now);
    for (const bucket of buckets) {
      expect(wall(bucket.start, 'Asia/Kolkata').endsWith(':00')).toBe(true);
    }
  });

  it('uses five-minute points for the last hour and six-hour points for three days', () => {
    const hour = trendBuckets(DASHBOARD_RANGE_SPECS['1h'], 'UTC', now);
    expect(hour).toHaveLength(12);
    expect(hour.at(-1)!.start).toBe(Date.UTC(2026, 9, 2, 14, 35));

    const days = trendBuckets(DASHBOARD_RANGE_SPECS['3d'], 'Europe/Istanbul', now);
    expect(days).toHaveLength(12);
    // 17:37 sits in the 12:00 point; the three days before it end there.
    expect(wall(days[0]!.start, 'Europe/Istanbul')).toBe('2026-09-29 18:00');
    expect(wall(days.at(-1)!.start, 'Europe/Istanbul')).toBe('2026-10-02 12:00');
    expect(days.every((bucket) => bucket.end - bucket.start === 6 * HOUR)).toBe(true);
  });

  it('starts days at local midnight, today included', () => {
    const buckets = trendBuckets(DASHBOARD_RANGE_SPECS['7d'], 'Europe/Istanbul', now);
    expect(buckets).toHaveLength(7);
    expect(buckets.map((bucket) => wall(bucket.start, 'Europe/Istanbul'))).toEqual([
      '2026-09-26 00:00',
      '2026-09-27 00:00',
      '2026-09-28 00:00',
      '2026-09-29 00:00',
      '2026-09-30 00:00',
      '2026-10-01 00:00',
      '2026-10-02 00:00',
    ]);
  });

  it('keeps every midnight in place across a daylight-saving change', () => {
    // Berlin falls back on 25 October 2026, so that day is 25 hours long.
    const later = Date.UTC(2026, 10, 1, 12);
    const buckets = trendBuckets(DASHBOARD_RANGE_SPECS['30d'], 'Europe/Berlin', later);
    expect(buckets).toHaveLength(30);
    for (const bucket of buckets) {
      expect(wall(bucket.start, 'Europe/Berlin').endsWith('00:00')).toBe(true);
    }
    const changeover = buckets.find(
      (bucket) => wall(bucket.start, 'Europe/Berlin') === '2026-10-25 00:00',
    )!;
    expect(changeover.end - changeover.start).toBe(25 * HOUR);
  });

  it('leaves no gap between points, so every instant in the period is counted once', () => {
    const buckets = trendBuckets(DASHBOARD_RANGE_SPECS['30d'], 'Europe/Berlin', now);
    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index]!.start).toBe(buckets[index - 1]!.end);
    }
    expect(bucketIndex(buckets, buckets[0]!.start - 1)).toBe(-1);
    expect(bucketIndex(buckets, buckets.at(-1)!.end)).toBe(-1);
  });
});
