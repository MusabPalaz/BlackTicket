import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { Permission, toCsv } from '@black-ticket/shared';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditQueryDto } from './dto/admin.dto';

/**
 * Read access to the immutable trail.
 *
 * The table itself rejects UPDATE and DELETE at the database level, so this is
 * the only interface to it — and it is read-only by construction.
 */
@ApiTags('admin')
@Controller('admin/audit')
@RequirePermissions(Permission.AUDIT_READ)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('actions')
  @ApiOperation({ summary: 'Distinct action names, for the filter dropdown' })
  async actions() {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 100,
    });
    return { items: rows.map((row) => row.action) };
  }

  @Get()
  @ApiOperation({ summary: 'Search the audit trail; add csv=true for an export' })
  async list(@Query() query: AuditQueryDto, @Res({ passthrough: true }) response: Response) {
    const page = query.page ?? 1;
    const size = query.size ?? 50;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    if (query.csv) {
      const startedAt = new Date();
      const csv = toCsv(AuditController.CSV_HEADER, await this.collectCsvRows(where, startedAt));

      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-${startedAt.toISOString().slice(0, 10)}.csv"`,
      );
      return csv;
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, username: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor,
      actorIp: row.actorIp,
      before: row.before,
      after: row.after,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, size, pages: Math.max(1, Math.ceil(total / size)) };
  }

  /** Rows per round trip while building an export. */
  private static readonly CSV_BATCH = 1_000;

  private static readonly CSV_HEADER = [
    'timestamp',
    'action',
    'entityType',
    'entityId',
    'actor',
    'ip',
    'before',
    'after',
    'metadata',
  ];

  /**
   * Every matching row, for auditors and incident reviews. The JSON diffs are
   * flattened into one column each rather than dropped.
   *
   * This used to hand back a single page of 5 000 rows and say nothing about
   * the rest — the one thing an audit export must never do, because a
   * truncated file is indistinguishable from a complete one once it leaves the
   * system. There is no ceiling now; the batching only keeps any single query
   * bounded, and the date filters remain the way to keep an export small.
   *
   * The window is pinned to the moment the export starts. The table is
   * append-only and sorted newest first, so without that upper bound a row
   * written mid-export would shift every later page down and duplicate a row.
   */
  private async collectCsvRows(where: Prisma.AuditLogWhereInput, startedAt: Date) {
    const window: Prisma.AuditLogWhereInput = { AND: [where, { createdAt: { lte: startedAt } }] };
    const lines: (string | null)[][] = [];

    for (let skip = 0; ; skip += AuditController.CSV_BATCH) {
      const batch = await this.prisma.auditLog.findMany({
        where: window,
        include: { actor: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: AuditController.CSV_BATCH,
      });

      for (const row of batch) {
        lines.push([
          row.createdAt.toISOString(),
          row.action,
          row.entityType,
          row.entityId,
          row.actor?.username ?? 'system',
          row.actorIp,
          row.before ? JSON.stringify(row.before) : '',
          row.after ? JSON.stringify(row.after) : '',
          row.metadata ? JSON.stringify(row.metadata) : '',
        ]);
      }

      if (batch.length < AuditController.CSV_BATCH) break;
    }

    return lines;
  }
}
