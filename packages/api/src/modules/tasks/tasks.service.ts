import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CaseTask, Prisma } from '@prisma/client';
import { AuditAction, CaseStatus, TaskStatus } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ActorContext } from '../cases/cases.service';
import type { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

const TASK_INCLUDE = {
  assignee: { select: { id: true, username: true, fullName: true } },
  createdBy: { select: { id: true, username: true, fullName: true } },
  _count: { select: { logs: true } },
  /*
   * Answers travel with the task.
   *
   * A playbook task is a question, and the answer is the point of it — hiding
   * it behind a button meant the case read as a list of unanswered prompts.
   * Capped so a long-running case cannot turn one request into a transcript.
   */
  logs: {
    include: { author: { select: { id: true, username: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
    take: 20,
  },
} satisfies Prisma.CaseTaskInclude;

type TaskWithRelations = Prisma.CaseTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static serialize(task: TaskWithRelations) {
    return {
      id: task.id,
      caseId: task.caseId,
      title: task.title,
      description: task.description,
      status: task.status,
      sortOrder: task.sortOrder,
      assignee: task.assignee,
      createdBy: task.createdBy,
      dueAt: task.dueAt?.toISOString() ?? null,
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      logCount: task._count.logs,
      templateItemId: task.templateItemId,
      answers: task.logs.map((log) => ({
        id: log.id,
        body: log.body,
        author: log.author,
        createdAt: log.createdAt.toISOString(),
      })),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private async openCaseOrThrow(caseId: string): Promise<{ id: string; status: string }> {
    const row = await this.prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('Case not found');
    if (row.status === CaseStatus.CLOSED) {
      throw new BadRequestException('Reopen the case before changing its tasks.');
    }
    return row;
  }

  private async taskOrThrow(taskId: string): Promise<CaseTask> {
    const task = await this.prisma.caseTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async list(caseId: string) {
    const tasks = await this.prisma.caseTask.findMany({
      where: { caseId },
      include: TASK_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: tasks.map(TasksService.serialize) };
  }

  async create(caseId: string, dto: CreateTaskDto, actor: ActorContext) {
    await this.openCaseOrThrow(caseId);

    const last = await this.prisma.caseTask.findFirst({
      where: { caseId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const task = await this.prisma.caseTask.create({
      data: {
        caseId,
        title: dto.title.trim(),
        description: dto.description ?? '',
        assigneeId: dto.assigneeId ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        sortOrder: (last?.sortOrder ?? 0) + 10,
        createdById: actor.user.id,
      },
      include: TASK_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'CaseTask',
      entityId: task.id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      after: { caseId, title: task.title },
      metadata: { caseId },
    });

    return TasksService.serialize(task);
  }

  async update(taskId: string, dto: UpdateTaskDto, actor: ActorContext) {
    const existing = await this.taskOrThrow(taskId);
    await this.openCaseOrThrow(existing.caseId);

    const now = new Date();
    const statusPatch: Prisma.CaseTaskUncheckedUpdateInput = {};

    if (dto.status && dto.status !== existing.status) {
      statusPatch.status = dto.status;
      // Timestamps follow the status rather than being set by the client, so
      // the durations in reports cannot be fabricated from the UI.
      if (dto.status === TaskStatus.IN_PROGRESS && !existing.startedAt) {
        statusPatch.startedAt = now;
      }
      if (dto.status === TaskStatus.DONE) {
        statusPatch.completedAt = now;
        if (!existing.startedAt) statusPatch.startedAt = now;
      }
      if (dto.status === TaskStatus.TODO) {
        statusPatch.completedAt = null;
      }
    }

    const task = await this.prisma.caseTask.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...statusPatch,
      },
      include: TASK_INCLUDE,
    });

    if (dto.status === TaskStatus.IN_PROGRESS || dto.status === TaskStatus.DONE) {
      await this.markFirstResponse(existing.caseId);
    }

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'CaseTask',
      entityId: taskId,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { status: existing.status, title: existing.title, assigneeId: existing.assigneeId },
      after: { status: task.status, title: task.title, assigneeId: task.assigneeId },
      metadata: { caseId: existing.caseId },
    });

    return TasksService.serialize(task);
  }

  /** Working on a case is itself the first response, whatever the status says. */
  private async markFirstResponse(caseId: string): Promise<void> {
    await this.prisma.case.updateMany({
      where: { id: caseId, firstResponseAt: null },
      data: { firstResponseAt: new Date() },
    });
  }

  async listLogs(taskId: string) {
    await this.taskOrThrow(taskId);
    const logs = await this.prisma.taskLog.findMany({
      where: { taskId },
      include: { author: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return {
      items: logs.map((log) => ({
        id: log.id,
        body: log.body,
        author: log.author,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  async addLog(taskId: string, body: string, actor: ActorContext) {
    const task = await this.taskOrThrow(taskId);
    await this.openCaseOrThrow(task.caseId);

    const log = await this.prisma.taskLog.create({
      data: { taskId, authorId: actor.user.id, body: body.trim() },
      include: { author: { select: { id: true, username: true, fullName: true } } },
    });

    await this.markFirstResponse(task.caseId);

    // Notes are the investigation record; they are never editable, so the
    // audit entry only needs to say that one was added.
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'TaskLog',
      entityId: log.id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      metadata: { caseId: task.caseId, taskId },
    });

    return {
      id: log.id,
      body: log.body,
      author: log.author,
      createdAt: log.createdAt.toISOString(),
    };
  }
}
