import { Injectable } from '@nestjs/common';
import { CaseStatus, Severity, formatCaseNumber } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { slaBreachedWhere } from '../cases/sla-breach';

const OPEN_STATUSES = [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING];

const DAY_MS = 86_400_000;

/** Maps an instant to its `YYYY-MM-DD` as seen in a time zone. */
function dayKeyIn(timeZone: string): (instant: Date) => string {
  // en-CA formats dates as YYYY-MM-DD.
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (instant) => format.format(instant);
}

/** The time zone to count days in: the viewer's, when it is a real one. */
export function resolveTimeZone(value: string | undefined): string {
  if (!value || value.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

/**
 * Numbers behind the dashboard widgets.
 *
 * Each widget maps to one method here rather than one giant payload, so a
 * dashboard showing three widgets does three small queries instead of paying
 * for twelve it will not draw.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cases opened and closed per day — the shape of the workload.
   *
   * Days are the viewer's calendar days, today included. Counting them in the
   * server's zone (UTC in the container) put a case opened at 01:00 in
   * Istanbul on the previous day, and a server in a zone east of UTC dropped
   * today from the chart altogether.
   */
  async caseTrend(days: number, timeZone: string) {
    const now = new Date();
    const dayKey = dayKeyIn(timeZone);
    const today = dayKey(now);

    // Calendar arithmetic on the date itself, so a daylight-saving change
    // cannot skip or repeat a day.
    const [year, month, day] = today.split('-').map(Number) as [number, number, number];
    const buckets = new Map<string, { date: string; opened: number; closed: number }>();
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10);
      buckets.set(date, { date, opened: 0, closed: 0 });
    }

    // A day either side of the window covers every zone's offset; rows that
    // land outside the buckets are simply not counted.
    const since = new Date(now.getTime() - (days + 1) * DAY_MS);
    const [opened, closed] = await Promise.all([
      this.prisma.case.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.case.findMany({
        where: { deletedAt: null, closedAt: { gte: since } },
        select: { closedAt: true },
      }),
    ]);

    for (const row of opened) {
      const bucket = buckets.get(dayKey(row.createdAt));
      if (bucket) bucket.opened += 1;
    }
    for (const row of closed) {
      const bucket = buckets.get(dayKey(row.closedAt!));
      if (bucket) bucket.closed += 1;
    }

    return { timeZone, items: [...buckets.values()] };
  }

  async openBySeverity() {
    const grouped = await this.prisma.case.groupBy({
      by: ['severity'],
      where: { deletedAt: null, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    });

    return {
      items: Object.values(Severity).map((severity) => ({
        severity,
        count: grouped.find((entry) => entry.severity === severity)?._count._all ?? 0,
      })),
    };
  }

  async openByStatus() {
    const grouped = await this.prisma.case.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });

    return {
      items: Object.values(CaseStatus).map((status) => ({
        status,
        count: grouped.find((entry) => entry.status === status)?._count._all ?? 0,
      })),
    };
  }

  /**
   * How the team is doing against the targets, over the chosen window.
   *
   * `since` goes back with the numbers so the widget's drill-downs filter on
   * exactly the same instant — a list that also showed older closures would
   * not add up to the figure it was opened from.
   */
  async slaCompliance(days: number) {
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);

    const closed = await this.prisma.case.findMany({
      where: { deletedAt: null, status: CaseStatus.CLOSED, closedAt: { gte: since } },
      select: { slaBreached: true },
    });

    const onTime = closed.filter((row) => !row.slaBreached).length;
    const breached = closed.length - onTime;

    const openBreached = await this.prisma.case.count({
      where: { deletedAt: null, status: { in: OPEN_STATUSES }, ...slaBreachedWhere(true, now) },
    });

    return {
      since: since.toISOString(),
      closed: closed.length,
      onTime,
      breached,
      openBreached,
      compliance: closed.length ? Math.round((onTime / closed.length) * 100) : null,
    };
  }

  /** Mean time to resolve, in hours, per severity. */
  async resolutionTime(days: number) {
    const since = new Date(Date.now() - days * DAY_MS);

    const rows = await this.prisma.case.findMany({
      where: { deletedAt: null, status: CaseStatus.CLOSED, closedAt: { gte: since } },
      select: { severity: true, occurredAt: true, closedAt: true },
    });

    const totals = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      const hours = (row.closedAt!.getTime() - row.occurredAt.getTime()) / 3_600_000;
      const entry = totals.get(row.severity) ?? { total: 0, count: 0 };
      entry.total += hours;
      entry.count += 1;
      totals.set(row.severity, entry);
    }

    return {
      since: since.toISOString(),
      items: Object.values(Severity).map((severity) => {
        const entry = totals.get(severity);
        return {
          severity,
          hours: entry ? Math.round((entry.total / entry.count) * 10) / 10 : null,
          cases: entry?.count ?? 0,
        };
      }),
    };
  }

  /** Who is carrying what. Unassigned is shown as its own bar on purpose. */
  async workload() {
    const grouped = await this.prisma.case.groupBy({
      by: ['assigneeId'],
      where: { deletedAt: null, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    });

    const ids = grouped.map((entry) => entry.assigneeId).filter((id): id is string => Boolean(id));
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, username: true },
    });

    // Two people with the same display name would otherwise be two bars with
    // the same label and no way to tell whose is whose.
    const nameCount = new Map<string, number>();
    for (const person of people) {
      nameCount.set(person.fullName, (nameCount.get(person.fullName) ?? 0) + 1);
    }
    const label = (id: string) => {
      const person = people.find((candidate) => candidate.id === id);
      if (!person) return 'unknown';
      return (nameCount.get(person.fullName) ?? 0) > 1
        ? `${person.fullName} (${person.username})`
        : person.fullName;
    };

    return {
      items: grouped
        .map((entry) => ({
          id: entry.assigneeId,
          name: entry.assigneeId ? label(entry.assigneeId) : 'Unassigned',
          count: entry._count._all,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  async alertsByStatus() {
    const grouped = await this.prisma.alert.groupBy({ by: ['status'], _count: { _all: true } });
    return { items: grouped.map((entry) => ({ status: entry.status, count: entry._count._all })) };
  }

  async alertsBySource(days: number) {
    const since = new Date(Date.now() - days * DAY_MS);
    const grouped = await this.prisma.alert.groupBy({
      by: ['source'],
      where: { receivedAt: { gte: since } },
      _count: { _all: true },
    });

    return {
      since: since.toISOString(),
      items: grouped
        .map((entry) => ({ source: entry.source, count: entry._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  /**
   * Counted in the database over every case. Reading the tag arrays into the
   * process used to stop at 5,000 cases, which at a year's volume meant the
   * ranking came from an arbitrary slice of them.
   */
  async topTags(limit: number) {
    const rows = await this.prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(DISTINCT "case"."id") AS count
      FROM "case", unnest("tags") AS tag
      WHERE "deletedAt" IS NULL
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT ${limit}
    `;

    return { items: rows.map((row) => ({ tag: row.tag, count: Number(row.count) })) };
  }

  /** Indicators seen on the most cases — the recurring ones worth blocking. */
  async topObservables(limit: number) {
    const rows = await this.prisma.observable.findMany({
      where: { sightingCount: { gt: 1 } },
      orderBy: { sightingCount: 'desc' },
      take: limit,
      select: { id: true, type: true, value: true, normalizedValue: true, sightingCount: true, isNoisy: true },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        value: row.normalizedValue,
        sightings: row.sightingCount,
        isNoisy: row.isNoisy,
      })),
    };
  }

  /** The queue an analyst works from, by deadline. */
  async dueSoon(limit: number) {
    const rows = await this.prisma.case.findMany({
      where: { deletedAt: null, status: { in: OPEN_STATUSES } },
      orderBy: [{ slaDueAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        number: true,
        title: true,
        severity: true,
        status: true,
        slaDueAt: true,
        slaBreached: true,
        createdAt: true,
        assignee: { select: { fullName: true } },
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        reference: formatCaseNumber(row.number, row.createdAt),
        title: row.title,
        severity: row.severity,
        status: row.status,
        slaDueAt: row.slaDueAt?.toISOString() ?? null,
        slaBreached: row.slaBreached,
        assignee: row.assignee?.fullName ?? null,
      })),
    };
  }

  async mitreCoverage(limit: number) {
    const grouped = await this.prisma.caseMitre.groupBy({
      by: ['techniqueId'],
      // A deleted case is not in the list this opens, so it cannot be counted.
      where: { case: { deletedAt: null } },
      _count: { _all: true },
      orderBy: { _count: { techniqueId: 'desc' } },
      take: limit,
    });

    const techniques = await this.prisma.mitreTechnique.findMany({
      where: { id: { in: grouped.map((entry) => entry.techniqueId) } },
      select: { id: true, name: true, tactic: true },
    });

    return {
      items: grouped.map((entry) => {
        const technique = techniques.find((row) => row.id === entry.techniqueId);
        return {
          id: entry.techniqueId,
          name: technique?.name ?? entry.techniqueId,
          tactic: technique?.tactic ?? '',
          count: entry._count._all,
        };
      }),
    };
  }
}
