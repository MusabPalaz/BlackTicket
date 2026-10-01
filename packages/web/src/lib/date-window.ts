/**
 * Date windows in words, for the filter chips a dashboard click leaves on a
 * list. All in the reader's own zone — the zone the dashboard counted in.
 */

const pad = (value: number) => String(value).padStart(2, '0');
const day = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const time = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const atMidnight = (date: Date) =>
  date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;

/** "2026-10-02" for a midnight, "2026-10-02 14:20" for any other moment. */
function stamp(date: Date): string {
  return atMidnight(date) ? day(date) : `${day(date)} ${time(date)}`;
}

/**
 * "since 2026-10-02 14:20", "on 2026-10-02", "2026-10-02 14:00–15:00" or
 * "2026-09-26 – 2026-10-02". `to` is the last millisecond inside the window,
 * the way the lists take it, so the end shown is the instant after it.
 */
export function describeWindow(from: string, to: string | null): string {
  const start = new Date(from);
  if (!to) return `since ${stamp(start)}`;
  const end = new Date(new Date(to).getTime() + 1);
  const last = new Date(end.getTime() - 1);
  if (atMidnight(start) && atMidnight(end)) {
    return day(start) === day(last) ? `on ${day(start)}` : `${day(start)} – ${day(last)}`;
  }
  return day(start) === day(last)
    ? `${day(start)} ${time(start)}–${time(end)}`
    : `${stamp(start)} – ${stamp(end)}`;
}
