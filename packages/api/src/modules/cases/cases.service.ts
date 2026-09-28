import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import {
  AuditAction,
  type CaseResolution,
  CaseStatus,
  Permission,
  Severity,
  Tlp,
  can,
  canOnCase,
  canTransition,
  formatCaseNumber,
  MailTemplate,
  type Role,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TagsService } from './tags.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlaybooksService } from './playbooks.service';
import type {
  AssignCaseDto,
  CreateCaseDto,
  ListCasesQueryDto,
  UpdateCaseDto,
} from './dto/case.dto';

export interface ActorContext {
  user: User;
  ip: string | null;
  userAgent: string | null;
}

const CASE_DETAIL_INCLUDE = {
  category: true,
  reporter: { select: { id: true, username: true, fullName: true } },
  assignee: { select: { id: true, username: true, fullName: true } },
  mitre: { include: { technique: true } },
  _count: { select: { tasks: true, observables: true } },
} satisfies Prisma.CaseInclude;

type CaseWithRelations = Prisma.CaseGetPayload<{ include: typeof CASE_DETAIL_INCLUDE }>;

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tags: TagsService,
    private readonly playbooks: PlaybooksService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- helpers

  static serialize(row: CaseWithRelations) {
    return {
      id: row.id,
      number: row.number,
      reference: formatCaseNumber(row.number, row.createdAt),
      title: row.title,
      description: row.description,
      status: row.status,
      resolution: row.resolution,
      severity: row.severity,
      tlp: row.tlp,
      pap: row.pap,
      category: row.category
        ? { id: row.category.id, slug: row.category.slug, name: row.category.name, color: row.category.color }
        : null,
      reporter: row.reporter,
      assignee: row.assignee,
      sourceSystem: row.sourceSystem,
      sourceRef: row.sourceRef,
      occurredAt: row.occurredAt.toISOString(),
      firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      slaDueAt: row.slaDueAt?.toISOString() ?? null,
      slaFirstResponseDueAt: row.slaFirstResponseDueAt?.toISOString() ?? null,
      slaBreached: row.slaBreached,
      summary: row.summary,
      tags: row.tags,
      mitre: row.mitre.map((entry) => ({
        id: entry.technique.id,
        name: entry.technique.name,
        tactic: entry.technique.tactic,
        url: entry.technique.url,
      })),
      taskCount: row._count.tasks,
      observableCount: row._count.observables,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * SLA clocks run from when the incident happened, not from when someone got
   * around to opening the case — otherwise a late-filed case would look
   * comfortably inside its target.
   */
  private async computeSla(
    severity: Severity,
    occurredAt: Date,
  ): Promise<{ slaFirstResponseDueAt: Date | null; slaDueAt: Date | null }> {
    const policy = await this.prisma.slaPolicy.findUnique({ where: { severity } });
    if (!policy || !policy.isActive) {
      return { slaFirstResponseDueAt: null, slaDueAt: null };
    }
    return {
      slaFirstResponseDueAt: new Date(occurredAt.getTime() + policy.firstResponseMinutes * 60_000),
      slaDueAt: new Date(occurredAt.getTime() + policy.resolutionMinutes * 60_000),
    };
  }

  private async loadOrThrow(id: string): Promise<CaseWithRelations> {
    const row = await this.prisma.case.findFirst({
      where: { id, deletedAt: null },
      include: CASE_DETAIL_INCLUDE,
    });
    if (!row) throw new NotFoundException('Case not found');
    return row;
  }

  /**
   * Ownership gate for the `*_OWN` / `*_ANY` permission pairs. Route guards can
   * only check the role; whether this particular case belongs to the user is
   * knowable only here.
   */
  private assertCanAct(
    row: { reporterId: string; assigneeId: string | null },
    user: User,
    ownPermission: Permission,
    anyPermission: Permission,
  ): void {
    const allowed = canOnCase(user.role as Role, ownPermission, anyPermission, {
      userId: user.id,
      reporterId: row.reporterId,
      assigneeId: row.assigneeId,
    });
    if (!allowed) {
      throw new ForbiddenException(
        'This case belongs to another analyst. Ask a SOC lead to reassign it.',
      );
    }
  }

  /** Stamps the first analyst reaction, which is what the SLA measures. */
  private firstResponsePatch(row: { firstResponseAt: Date | null }): { firstResponseAt?: Date } {
    return row.firstResponseAt ? {} : { firstResponseAt: new Date() };
  }

  // ------------------------------------------------------------------ query

  async list(query: ListCasesQueryDto) {
    const page = query.page ?? 1;
    const size = query.size ?? 25;
    const sort = query.sort ?? 'createdAt';
    const order = query.order ?? 'desc';

    const where: Prisma.CaseWhereInput = { deletedAt: null };

    if (query.status?.length) where.status = { in: query.status };
    if (query.severity?.length) where.severity = { in: query.severity };
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.tag) where.tags = { has: query.tag };
    if (query.from || query.to) {
      const window = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
      if (query.dateField === 'createdAt') where.createdAt = window;
      else where.occurredAt = window;
    }
    if (query.atRisk) {
      where.status = { notIn: [CaseStatus.RESOLVED, CaseStatus.CLOSED] };
      where.slaDueAt = { lte: new Date(Date.now() + 4 * 3_600_000) };
    }
    if (query.breached) where.slaBreached = true;
    if (query.unassigned) where.assigneeId = null;
    if (query.mitre) where.mitre = { some: { techniqueId: query.mitre } };

    if (query.q) {
      const term = query.q.trim();
      const asNumber = Number(term.replace(/\D/g, ''));
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { tags: { has: term.toLowerCase() } },
        ...(Number.isSafeInteger(asNumber) && asNumber > 0 ? [{ number: asNumber }] : []),
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.case.findMany({
        where,
        include: CASE_DETAIL_INCLUDE,
        orderBy: { [sort]: order },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.case.count({ where }),
    ]);

    return {
      items: rows.map(CasesService.serialize),
      total,
      page,
      size,
      pages: Math.max(1, Math.ceil(total / size)),
    };
  }

  async getById(id: string) {
    const row = await this.loadOrThrow(id);
    return { ...CasesService.serialize(row), relatedCount: await this.relatedCaseCount(id) };
  }

  /**
   * Distinct cases on the other end of a link, not the number of links.
   *
   * Two cases sharing three indicators produce three link rows and are still
   * one related case — which is what the Related cases tab lists, so it is
   * what its counter has to say. Counting rows would quietly inflate it.
   *
   * Deliberately not part of `serialize`: that also runs for every row of the
   * case list, and a per-row query there would be an N+1 for a number no list
   * shows.
   */
  private async relatedCaseCount(id: string): Promise<number> {
    const links = await this.prisma.caseLink.findMany({
      where: {
        OR: [{ sourceCaseId: id }, { targetCaseId: id }],
        // Matches what the tab itself filters on, so the two cannot disagree.
        sourceCase: { deletedAt: null },
        targetCase: { deletedAt: null },
      },
      select: { sourceCaseId: true, targetCaseId: true },
    });

    return new Set(
      links.map((link) => (link.sourceCaseId === id ? link.targetCaseId : link.sourceCaseId)),
    ).size;
  }

  /** Counters for the dashboard: open work, unassigned queue, SLA pressure. */
  async summary(userId: string) {
    const openStatuses = [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING];
    const soon = new Date(Date.now() + 4 * 3_600_000);

    const [open, mine, unassigned, dueSoon, bySeverity] = await Promise.all([
      this.prisma.case.count({ where: { deletedAt: null, status: { in: openStatuses } } }),
      this.prisma.case.count({
        where: { deletedAt: null, status: { in: openStatuses }, assigneeId: userId },
      }),
      this.prisma.case.count({
        where: { deletedAt: null, status: { in: openStatuses }, assigneeId: null },
      }),
      this.prisma.case.count({
        where: { deletedAt: null, status: { in: openStatuses }, slaDueAt: { lte: soon } },
      }),
      this.prisma.case.groupBy({
        by: ['severity'],
        where: { deletedAt: null, status: { in: openStatuses } },
        _count: { _all: true },
      }),
    ]);

    return {
      open,
      mine,
      unassigned,
      dueSoon,
      bySeverity: Object.fromEntries(
        Object.values(Severity).map((severity) => [
          severity,
          bySeverity.find((entry) => entry.severity === severity)?._count._all ?? 0,
        ]),
      ),
    };
  }

  // ----------------------------------------------------------------- writes

  async create(dto: CreateCaseDto, actor: ActorContext) {
    const severity = dto.severity ?? Severity.MEDIUM;
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    if (occurredAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('The incident time cannot be in the future.');
    }

    if (dto.assigneeId) {
      this.assertMayAssignTo(actor.user.role as Role, actor.user.id, dto.assigneeId);
      await this.assertAssignable(dto.assigneeId);
    }
    if (dto.mitre?.length) await this.assertTechniquesExist(dto.mitre);

    const sla = await this.computeSla(severity, occurredAt);

    const created = await this.prisma.case.create({
      data: {
        title: dto.title.trim(),
        description: dto.description ?? '',
        severity,
        tlp: dto.tlp ?? Tlp.AMBER,
        pap: dto.pap ?? Tlp.AMBER,
        categoryId: dto.categoryId ?? null,
        reporterId: actor.user.id,
        assigneeId: dto.assigneeId ?? null,
        occurredAt,
        tags: (dto.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        ...sla,
        ...(dto.mitre?.length
          ? {
              mitre: {
                create: dto.mitre.map((techniqueId) => ({
                  techniqueId,
                  addedById: actor.user.id,
                })),
              },
            }
          : {}),
      },
      include: CASE_DETAIL_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Case',
      entityId: created.id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      after: { title: created.title, severity: created.severity, status: created.status },
      metadata: { reference: formatCaseNumber(created.number, created.createdAt) },
    });

    await this.tags.register(created.tags);

    // The checklist that matches these tags is attached straight away, so the
    // analyst starts from questions rather than an empty case.
    await this.playbooks.applyOnCreate(created.id, {
      id: actor.user.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.getById(created.id);
  }

  async update(id: string, dto: UpdateCaseDto, actor: ActorContext) {
    const row = await this.loadOrThrow(id);
    this.assertCanAct(row, actor.user, Permission.CASE_UPDATE_OWN, Permission.CASE_UPDATE_ANY);

    if (row.status === CaseStatus.CLOSED) {
      throw new BadRequestException('Reopen the case before editing it.');
    }

    // Assignment deliberately has its own endpoint: it carries its own
    // permission rule and is audited as ASSIGN rather than a generic UPDATE.
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : row.occurredAt;
    const severity = dto.severity ?? (row.severity as Severity);
    const slaInputsChanged =
      (dto.severity && dto.severity !== row.severity) ||
      (dto.occurredAt && occurredAt.getTime() !== row.occurredAt.getTime());

    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
        ...(dto.tlp !== undefined ? { tlp: dto.tlp } : {}),
        ...(dto.pap !== undefined ? { pap: dto.pap } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.occurredAt !== undefined ? { occurredAt } : {}),
        ...(dto.tags !== undefined
          ? { tags: dto.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean) }
          : {}),
        // Re-derive the SLA when its inputs move, unless the case is already done.
        ...(slaInputsChanged && !row.resolvedAt ? await this.computeSla(severity, occurredAt) : {}),
      },
      include: CASE_DETAIL_INCLUDE,
    });

    if (dto.tags !== undefined) {
      await this.tags.register(updated.tags);
    }

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Case',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: {
        title: row.title,
        severity: row.severity,
        tlp: row.tlp,
        pap: row.pap,
        categoryId: row.categoryId,
        tags: row.tags,
      },
      after: {
        title: updated.title,
        severity: updated.severity,
        tlp: updated.tlp,
        pap: updated.pap,
        categoryId: updated.categoryId,
        tags: updated.tags,
      },
    });

    return CasesService.serialize(updated);
  }

  /*
   * Who a role is allowed to point an assignment at, independent of any case
   * that already exists. Both the create and the assign path go through this
   * so a case cannot be born assigned to someone the assign endpoint would
   * refuse to hand it to. Leaving a case unassigned is never restricted here;
   * the assign path adds its own rules about releasing a case it can see.
   */
  private assertMayAssignTo(role: Role, actorId: string, targetId: string | null): void {
    if (can(role, Permission.CASE_ASSIGN_ANY)) return;
    if (!can(role, Permission.CASE_ASSIGN_SELF)) {
      throw new ForbiddenException('Your role cannot take cases.');
    }
    if (targetId !== null && targetId !== actorId) {
      throw new ForbiddenException('Analysts can only take cases themselves. Ask a SOC lead to reassign.');
    }
  }

  private async assertAssignable(userId: string): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] } },
      select: { role: true },
    });
    if (!target) throw new BadRequestException('That account cannot take cases.');
    if (target.role === 'READ_ONLY') {
      throw new BadRequestException('Read-only accounts cannot be assigned cases.');
    }
  }

  private async assertTechniquesExist(ids: string[]): Promise<void> {
    const found = await this.prisma.mitreTechnique.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) {
      throw new BadRequestException('One or more MITRE technique ids are unknown.');
    }
  }

  async assign(id: string, dto: AssignCaseDto, actor: ActorContext) {
    const row = await this.loadOrThrow(id);
    const targetId = dto.userId ?? null;
    const role = actor.user.role as Role;

    /*
     * Assignment does not follow the plain ownership rule.
     *
     * Taking an unassigned case off the queue is the normal way an analyst
     * starts work, so "owner" cannot be the test — an unclaimed case has no
     * owner yet. Analysts may claim a free case and drop their own; moving a
     * case that belongs to someone else stays a lead's decision.
     */
    this.assertMayAssignTo(role, actor.user.id, targetId);

    if (!can(role, Permission.CASE_ASSIGN_ANY)) {
      const claimingForSelf = targetId === actor.user.id;
      const releasing = targetId === null;
      const isFree = row.assigneeId === null;
      const isMine = row.assigneeId === actor.user.id;

      if (claimingForSelf && !isFree && !isMine) {
        throw new ForbiddenException('This case is already assigned to another analyst.');
      }
      if (releasing && !isMine) {
        throw new ForbiddenException('Only the current assignee can release a case.');
      }
    }

    if (targetId) await this.assertAssignable(targetId);

    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        assigneeId: targetId,
        ...(targetId && row.status === CaseStatus.NEW ? { status: CaseStatus.IN_PROGRESS } : {}),
        ...(targetId ? this.firstResponsePatch(row) : {}),
      },
      include: CASE_DETAIL_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.ASSIGN,
      entityType: 'Case',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      // Names, not ids: the timeline is read by analysts during a handover,
      // and a pair of UUIDs tells them nothing. The ids stay in metadata for
      // machine traceability.
      before: { assignee: row.assignee?.username ?? null },
      after: { assignee: updated.assignee?.username ?? null },
      metadata: { fromUserId: row.assigneeId, toUserId: targetId },
    });

    /*
     * Told only when someone else did it. An analyst who has just claimed a
     * case off the queue does not need to be informed that they now have it —
     * and a notification that says what you already know is how people learn
     * to stop reading them.
     */
    if (targetId && targetId !== actor.user.id) {
      await this.notifications.createMany([targetId], {
        type: 'CASE_ASSIGNED',
        title: `${formatCaseNumber(updated.number, updated.createdAt)} was assigned to you`,
        body: `${updated.severity} · ${updated.title}`,
        link: `/cases/${id}`,
        email: MailTemplate.CASE_ASSIGNED,
      });
    }

    return CasesService.serialize(updated);
  }

  async changeStatus(id: string, status: CaseStatus, actor: ActorContext) {
    const row = await this.loadOrThrow(id);
    this.assertCanAct(row, actor.user, Permission.CASE_UPDATE_OWN, Permission.CASE_UPDATE_ANY);

    if (status === CaseStatus.CLOSED || status === CaseStatus.RESOLVED) {
      throw new BadRequestException('Use the close endpoint, which records a resolution.');
    }

    if (!canTransition(row.status as CaseStatus, status)) {
      throw new BadRequestException(`Cannot move a case from ${row.status} to ${status}.`);
    }

    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        status,
        ...(status === CaseStatus.IN_PROGRESS ? this.firstResponsePatch(row) : {}),
      },
      include: CASE_DETAIL_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Case',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { status: row.status },
      after: { status },
    });

    return CasesService.serialize(updated);
  }

  async close(id: string, resolution: CaseResolution, summary: string, actor: ActorContext) {
    const row = await this.loadOrThrow(id);
    this.assertCanAct(row, actor.user, Permission.CASE_CLOSE_OWN, Permission.CASE_CLOSE_ANY);

    if (row.status === CaseStatus.CLOSED) {
      throw new BadRequestException('This case is already closed.');
    }
    if (!canTransition(row.status as CaseStatus, CaseStatus.RESOLVED)) {
      throw new BadRequestException(`Cannot close a case from status ${row.status}.`);
    }

    const now = new Date();
    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        status: CaseStatus.CLOSED,
        resolution,
        summary: summary.trim(),
        resolvedAt: row.resolvedAt ?? now,
        closedAt: now,
        ...this.firstResponsePatch(row),
        // The verdict is recorded at closing time; a later SLA sweep must not
        // re-open the question of whether this case breached.
        slaBreached: row.slaDueAt ? now.getTime() > row.slaDueAt.getTime() : false,
      },
      include: CASE_DETAIL_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.CLOSE,
      entityType: 'Case',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { status: row.status },
      after: { status: updated.status, resolution, slaBreached: updated.slaBreached },
    });

    return CasesService.serialize(updated);
  }

  async reopen(id: string, actor: ActorContext) {
    const row = await this.loadOrThrow(id);
    this.assertCanAct(row, actor.user, Permission.CASE_CLOSE_OWN, Permission.CASE_CLOSE_ANY);

    if (!canTransition(row.status as CaseStatus, CaseStatus.IN_PROGRESS)) {
      throw new BadRequestException(`Cannot reopen a case in status ${row.status}.`);
    }

    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        status: CaseStatus.IN_PROGRESS,
        resolution: null,
        closedAt: null,
        resolvedAt: null,
      },
      include: CASE_DETAIL_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.REOPEN,
      entityType: 'Case',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { status: row.status, resolution: row.resolution },
      after: { status: updated.status },
    });

    return CasesService.serialize(updated);
  }

  async softDelete(id: string, actor: ActorContext): Promise<void> {
    const row = await this.loadOrThrow(id);

    await this.prisma.case.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Case',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { title: row.title, status: row.status },
      metadata: { reference: formatCaseNumber(row.number, row.createdAt) },
    });
  }

  // ------------------------------------------------------------------ MITRE

  async setMitre(id: string, techniqueIds: string[], actor: ActorContext) {
    const row = await this.loadOrThrow(id);
    this.assertCanAct(row, actor.user, Permission.CASE_UPDATE_OWN, Permission.CASE_UPDATE_ANY);
    if (techniqueIds.length) await this.assertTechniquesExist(techniqueIds);

    await this.prisma.$transaction([
      this.prisma.caseMitre.deleteMany({ where: { caseId: id } }),
      this.prisma.caseMitre.createMany({
        data: techniqueIds.map((techniqueId) => ({
          caseId: id,
          techniqueId,
          addedById: actor.user.id,
        })),
        skipDuplicates: true,
      }),
    ]);

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Case',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { mitre: row.mitre.map((entry) => entry.techniqueId) },
      after: { mitre: techniqueIds },
    });

    return this.getById(id);
  }

  // --------------------------------------------------------------- timeline

  /**
   * One chronological feed of everything that happened to a case: the audit
   * trail plus the analyst's own notes. Built by merging rather than stored,
   * so it can never drift from the records it describes.
   */
  async timeline(id: string) {
    await this.loadOrThrow(id);

    const [auditEntries, taskLogs, tasks] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entityType: 'Case', entityId: id },
        include: { actor: { select: { id: true, username: true, fullName: true } } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
      this.prisma.taskLog.findMany({
        where: { task: { caseId: id } },
        include: {
          author: { select: { id: true, username: true, fullName: true } },
          task: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
      this.prisma.caseTask.findMany({
        where: { caseId: id },
        include: { createdBy: { select: { id: true, username: true, fullName: true } } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    ]);

    const events = [
      ...auditEntries.map((entry) => ({
        kind: 'audit' as const,
        at: entry.createdAt.toISOString(),
        action: entry.action,
        actor: entry.actor,
        before: entry.before,
        after: entry.after,
        metadata: entry.metadata,
      })),
      ...tasks.map((task) => ({
        kind: 'task' as const,
        at: task.createdAt.toISOString(),
        action: 'TASK_CREATED',
        actor: task.createdBy,
        taskId: task.id,
        title: task.title,
      })),
      ...taskLogs.map((log) => ({
        kind: 'note' as const,
        at: log.createdAt.toISOString(),
        action: 'TASK_LOG',
        actor: log.author,
        taskId: log.task.id,
        title: log.task.title,
        // Deliberately no body: the timeline says that an answer was written
        // and by whom; the answer itself lives on the task, in one place.
      })),
    ];

    events.sort((a, b) => b.at.localeCompare(a.at));
    return { items: events };
  }
}
