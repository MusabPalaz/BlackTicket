import { Injectable } from '@nestjs/common';
import { CaseStatus, Severity, formatCaseNumber } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';

const OPEN_STATUSES = [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING];

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

  /** Cases opened and closed per day — the shape of the workload. */
  async caseTrend(days: number) {
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setHours(0, 0, 0, 0);

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

    const buckets = new Map<string, { date: string; opened: number; closed: number }>();
    for (let index = 0; index < days; index += 1) {
      const day = new Date(since.getTime() + index * 86_400_000).toISOString().slice(0, 10);
      buckets.set(day, { date: day, opened: 0, closed: 0 });
    }

    for (const row of opened) {
      const key = row.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.opened += 1;
    }
    for (const row of closed) {
      const key = row.closedAt!.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.closed += 1;
    }

    return { items: [...buckets.values()] };
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

  /** How the team is doing against the targets, over the chosen window. */
  async slaCompliance(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);

    const closed = await this.prisma.case.findMany({
      where: { deletedAt: null, closedAt: { gte: since } },
      select: { slaBreached: true, severity: true },
    });

    const onTime = closed.filter((row) => !row.slaBreached).length;
    const breached = closed.length - onTime;

    const openBreached = await this.prisma.case.count({
      where: { deletedAt: null, status: { in: OPEN_STATUSES }, slaBreached: true },
    });

    return {
      closed: closed.length,
      onTime,
      breached,
      openBreached,
      compliance: closed.length ? Math.round((onTime / closed.length) * 100) : null,
    };
  }

  /** Mean time to resolve, in hours, per severity. */
  async resolutionTime(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await this.prisma.case.findMany({
      where: { deletedAt: null, closedAt: { gte: since }, resolvedAt: { not: null } },
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
      select: { id: true, fullName: true },
    });

    return {
      items: grouped
        .map((entry) => ({
          id: entry.assigneeId,
          name: entry.assigneeId
            ? (people.find((person) => person.id === entry.assigneeId)?.fullName ?? 'unknown')
            : 'Unassigned',
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
    const since = new Date(Date.now() - days * 86_400_000);
    const grouped = await this.prisma.alert.groupBy({
      by: ['source'],
      where: { receivedAt: { gte: since } },
      _count: { _all: true },
    });

    return {
      items: grouped
        .map((entry) => ({ source: entry.source, count: entry._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  async topTags(limit: number) {
    const rows = await this.prisma.case.findMany({
      where: { deletedAt: null },
      select: { tags: true },
      take: 5_000,
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    return {
      items: [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit),
    };
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
