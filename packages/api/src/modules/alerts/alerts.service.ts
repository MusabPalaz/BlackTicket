import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ApiKey, Prisma } from '@prisma/client';
import {
  AlertStatus,
  AuditAction,
  CaseStatus,
  Severity,
  formatCaseNumber,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CasesService, type ActorContext } from '../cases/cases.service';
import { ObservablesService } from '../observables/observables.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  IgnoreAlertDto,
  ImportAlertDto,
  IngestAlertDto,
  ListAlertsQueryDto,
  RestoreAlertDto,
} from './dto/alert.dto';
import type { ObservableInputDto } from '../observables/dto/observable.dto';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
    private readonly observables: ObservablesService,
    private readonly notifications: NotificationsService,
  ) {}

  private static serialize(row: Prisma.AlertGetPayload<{ include: { category: true; case: { select: { id: true; number: true; title: true; createdAt: true } } } }>) {
    return {
      id: row.id,
      externalId: row.externalId,
      source: row.source,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      category: row.category ? { id: row.category.id, slug: row.category.slug, name: row.category.name } : null,
      observables: row.observables,
      mitre: row.mitre,
      raw: row.rawPayload,
      case: row.case
        ? { id: row.case.id, reference: formatCaseNumber(row.case.number, row.case.createdAt), title: row.case.title }
        : null,
      occurredAt: row.occurredAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
    };
  }

  /**
   * Accepts one alert from a SIEM.
   *
   * Idempotent on (source, externalId): a retry after a network timeout — the
   * normal failure mode for a webhook — must not create a second alert. The
   * response says which happened so the sender can tell.
   */
  async ingest(dto: IngestAlertDto, apiKey: ApiKey) {
    const existing = await this.prisma.alert.findUnique({
      where: { source_externalId: { source: dto.source, externalId: dto.externalId } },
      select: { id: true, status: true, caseId: true },
    });

    if (existing) {
      return {
        id: existing.id,
        duplicate: true,
        status: existing.status,
        caseId: existing.caseId,
      };
    }

    const category = dto.category
      ? await this.prisma.category.findUnique({ where: { slug: dto.category.toLowerCase() } })
      : null;

    // Unknown technique ids are dropped rather than rejecting the whole alert:
    // losing a tag is better than losing the detection.
    const knownTechniques = dto.mitre?.length
      ? await this.prisma.mitreTechnique.findMany({
          where: { id: { in: dto.mitre } },
          select: { id: true },
        })
      : [];
    const droppedTechniques = (dto.mitre ?? []).filter(
      (id) => !knownTechniques.some((technique) => technique.id === id),
    );

    const alert = await this.prisma.alert.create({
      data: {
        externalId: dto.externalId,
        source: dto.source,
        title: dto.title.trim(),
        description: dto.description ?? '',
        severity: dto.severity ?? Severity.MEDIUM,
        categoryId: category?.id ?? null,
        rawPayload: (dto.raw ?? {}) as Prisma.InputJsonValue,
        observables: (dto.observables ?? []) as unknown as Prisma.InputJsonValue,
        mitre: knownTechniques.map((technique) => technique.id),
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        apiKeyId: apiKey.id,
      },
    });

    await this.audit.record({
      action: AuditAction.ALERT_INGESTED,
      entityType: 'Alert',
      entityId: alert.id,
      metadata: {
        source: alert.source,
        externalId: alert.externalId,
        apiKey: apiKey.name,
        droppedTechniques: droppedTechniques.length ? droppedTechniques : undefined,
      },
    });

    if (droppedTechniques.length) {
      this.logger.warn(
        `Alert ${alert.source}/${alert.externalId} referenced unknown MITRE ids: ${droppedTechniques.join(', ')}`,
      );
    }

    return {
      id: alert.id,
      duplicate: false,
      status: alert.status,
      droppedTechniques,
    };
  }

  async list(query: ListAlertsQueryDto) {
    const page = query.page ?? 1;
    const size = query.size ?? 25;

    const where: Prisma.AlertWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.from ? { receivedAt: { gte: new Date(query.from) } } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { externalId: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const include = {
      category: true,
      case: { select: { id: true, number: true, title: true, createdAt: true } },
    } as const;

    const [rows, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        include,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return {
      items: rows.map(AlertsService.serialize),
      total,
      page,
      size,
      pages: Math.max(1, Math.ceil(total / size)),
    };
  }

  async counts() {
    const grouped = await this.prisma.alert.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(
      Object.values(AlertStatus).map((status) => [
        status,
        grouped.find((entry) => entry.status === status)?._count._all ?? 0,
      ]),
    );
  }

  async getById(id: string) {
    const row = await this.prisma.alert.findUnique({
      where: { id },
      include: { category: true, case: { select: { id: true, number: true, title: true, createdAt: true } } },
    });
    if (!row) throw new NotFoundException('Alert not found');
    return AlertsService.serialize(row);
  }

  private observablesOf(alert: { observables: Prisma.JsonValue }): ObservableInputDto[] {
    return Array.isArray(alert.observables) ? (alert.observables as unknown as ObservableInputDto[]) : [];
  }

  /** Turns an alert into a new case, carrying its indicators across. */
  async importToCase(id: string, dto: ImportAlertDto, actor: ActorContext) {
    const alert = await this.prisma.alert.findUnique({ where: { id }, include: { category: true } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.status === AlertStatus.IMPORTED) {
      throw new BadRequestException('This alert is already part of a case.');
    }

    const created = await this.cases.create(
      {
        title: dto.title ?? alert.title,
        description: alert.description,
        severity: dto.severity ?? (alert.severity as Severity),
        categoryId: alert.categoryId ?? undefined,
        assigneeId: dto.assigneeId,
        occurredAt: alert.occurredAt.toISOString(),
        mitre: alert.mitre.length ? alert.mitre : undefined,
      },
      actor,
    );

    // The source system is recorded so a case opened from an alert is
    // distinguishable from one an analyst typed by hand.
    await this.prisma.case.update({
      where: { id: created.id },
      data: { sourceSystem: alert.source, sourceRef: alert.externalId },
    });

    const observableResult = await this.observables.addToCase(
      created.id,
      this.observablesOf(alert),
      actor,
    );

    await this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.IMPORTED, caseId: created.id },
    });

    await this.audit.record({
      action: AuditAction.ALERT_IMPORTED,
      entityType: 'Alert',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      after: { caseId: created.id, reference: created.reference },
    });

    return {
      case: await this.cases.getById(created.id),
      observables: observableResult,
    };
  }

  /** Folds an alert into an existing case instead of opening a new one. */
  async mergeIntoCase(id: string, caseId: string, actor: ActorContext) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.status === AlertStatus.IMPORTED) {
      throw new BadRequestException('This alert is already part of a case.');
    }

    const target = await this.prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true, number: true, createdAt: true, status: true },
    });
    if (!target) throw new NotFoundException('Case not found');
    if (target.status === CaseStatus.CLOSED) {
      throw new BadRequestException('Reopen the case before merging an alert into it.');
    }

    const observableResult = await this.observables.addToCase(
      caseId,
      this.observablesOf(alert),
      actor,
    );

    await this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.IMPORTED, caseId },
    });

    await this.audit.record({
      action: AuditAction.ALERT_IMPORTED,
      entityType: 'Alert',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      after: { mergedInto: formatCaseNumber(target.number, target.createdAt) },
      metadata: { caseId },
    });

    return {
      case: await this.cases.getById(caseId),
      observables: observableResult,
    };
  }

  async ignore(id: string, dto: IgnoreAlertDto, actor: ActorContext) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.status === AlertStatus.IMPORTED) {
      throw new BadRequestException('An imported alert cannot be dismissed.');
    }

    await this.prisma.alert.update({ where: { id }, data: { status: AlertStatus.IGNORED } });

    await this.audit.record({
      action: AuditAction.ALERT_IGNORED,
      entityType: 'Alert',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      metadata: { reason: dto.reason, source: alert.source, externalId: alert.externalId },
    });

    return { id, status: AlertStatus.IGNORED };
  }

  /**
   * Undoes a dismissal: the alert is NEW again and back in the triage queue, at
   * the place its arrival time gives it, so whoever picks it up handles it the
   * normal way.
   * Only an ignored alert can be restored — one that became a case is dealt
   * with on the case, and a waiting one has nothing to undo.
   */
  async restore(id: string, dto: RestoreAlertDto, actor: ActorContext) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.status !== AlertStatus.IGNORED) {
      throw new BadRequestException('Only an ignored alert can be put back in the queue.');
    }

    await this.prisma.alert.update({ where: { id }, data: { status: AlertStatus.NEW } });

    await this.audit.record({
      action: AuditAction.ALERT_RESTORED,
      entityType: 'Alert',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { status: AlertStatus.IGNORED },
      after: { status: AlertStatus.NEW },
      metadata: { reason: dto.reason, source: alert.source, externalId: alert.externalId },
    });

    return { id, status: AlertStatus.NEW };
  }

  /** Used by the dashboard to show how long the queue has been waiting. */
  async oldestUntriaged(): Promise<string | null> {
    const oldest = await this.prisma.alert.findFirst({
      where: { status: AlertStatus.NEW },
      orderBy: { receivedAt: 'asc' },
      select: { receivedAt: true },
    });
    return oldest?.receivedAt.toISOString() ?? null;
  }

  /** Notifies analysts that fresh detections are waiting. Called by the sweep. */
  async notifyQueueBacklog(threshold: number): Promise<void> {
    const pending = await this.prisma.alert.count({ where: { status: AlertStatus.NEW } });
    if (pending < threshold) return;

    const recipients = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', role: { in: ['SOC_LEAD', 'ADMIN'] } },
      select: { id: true },
    });

    await this.notifications.createMany(
      recipients.map((recipient) => recipient.id),
      {
        type: 'ALERT_BACKLOG',
        title: `${pending} alerts waiting in the queue`,
        body: 'The alert queue has grown past the review threshold.',
        link: '/alerts',
        dedupeWindowMinutes: 60,
      },
    );
  }
}
