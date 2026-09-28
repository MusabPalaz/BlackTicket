import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditAction } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ApplyResult {
  applied: { templateId: string; templateName: string; created: number }[];
  skipped: number;
}

/**
 * Playbooks: the checklist a case starts with.
 *
 * Which one applies is decided by the case's tags and category, so a phishing
 * report opens with questions about headers, recipients and purge, while an
 * EDR detection opens with questions about the affected host and user. The
 * point is that the analyst writes the ticket by answering, rather than facing
 * an empty box.
 */
@Injectable()
export class PlaybooksService {
  private readonly logger = new Logger(PlaybooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false) {
    const items = await this.prisma.taskTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return {
      items: items.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        isDefault: template.isDefault,
        isActive: template.isActive,
        matchTags: template.matchTags,
        matchCategories: template.matchCategories,
        sortOrder: template.sortOrder,
        items: template.items.map((item) => ({
          id: item.id,
          title: item.title,
          prompt: item.prompt,
          sortOrder: item.sortOrder,
        })),
      })),
    };
  }

  /**
   * Which playbooks fit a case: the default one, plus any whose tag or
   * category matcher overlaps.
   */
  async matchingTemplates(tags: string[], categorySlug: string | null) {
    const normalizedTags = tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);

    return this.prisma.taskTemplate.findMany({
      where: {
        isActive: true,
        OR: [
          { isDefault: true },
          ...(normalizedTags.length ? [{ matchTags: { hasSome: normalizedTags } }] : []),
          ...(categorySlug ? [{ matchCategories: { has: categorySlug } }] : []),
        ],
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Adds the checklist to a case.
   *
   * Already-present items are skipped, identified by the template item they
   * came from and by title — re-applying after a tag changes tops the list up
   * instead of duplicating it.
   */
  async apply(
    caseId: string,
    templateIds: string[] | 'auto',
    actor: { id: string; ip: string | null; userAgent: string | null },
  ): Promise<ApplyResult> {
    const row = await this.prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true, tags: true, category: { select: { slug: true } } },
    });
    if (!row) throw new NotFoundException('Case not found');

    const templates =
      templateIds === 'auto'
        ? await this.matchingTemplates(row.tags, row.category?.slug ?? null)
        : await this.prisma.taskTemplate.findMany({
            where: { id: { in: templateIds }, isActive: true },
            include: { items: { orderBy: { sortOrder: 'asc' } } },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          });

    if (templates.length === 0) return { applied: [], skipped: 0 };

    const existing = await this.prisma.caseTask.findMany({
      where: { caseId },
      select: { title: true, templateItemId: true, sortOrder: true },
    });
    const takenItemIds = new Set(existing.map((task) => task.templateItemId).filter(Boolean));
    const takenTitles = new Set(existing.map((task) => task.title.trim().toLowerCase()));
    let nextOrder = existing.reduce((max, task) => Math.max(max, task.sortOrder), 0);

    const result: ApplyResult = { applied: [], skipped: 0 };
    const created: Prisma.CaseTaskCreateManyInput[] = [];

    for (const template of templates) {
      let createdHere = 0;

      for (const item of template.items) {
        if (takenItemIds.has(item.id) || takenTitles.has(item.title.trim().toLowerCase())) {
          result.skipped += 1;
          continue;
        }

        nextOrder += 10;
        created.push({
          caseId,
          title: item.title,
          // The prompt becomes the task description, so the question is in
          // front of the analyst while they work rather than in a manual.
          description: item.prompt,
          sortOrder: nextOrder,
          createdById: actor.id,
          templateItemId: item.id,
        });
        takenTitles.add(item.title.trim().toLowerCase());
        createdHere += 1;
      }

      if (createdHere > 0) {
        result.applied.push({ templateId: template.id, templateName: template.name, created: createdHere });
      }
    }

    if (created.length > 0) {
      await this.prisma.caseTask.createMany({ data: created });

      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: 'CaseTask',
        entityId: caseId,
        actorId: actor.id,
        actorIp: actor.ip,
        actorUserAgent: actor.userAgent,
        after: { playbooks: result.applied.map((entry) => entry.templateName), tasks: created.length },
        metadata: { caseId, automatic: templateIds === 'auto' },
      });
    }

    return result;
  }

  /** Applied on case creation; a failure here must not lose the case. */
  async applyOnCreate(
    caseId: string,
    actor: { id: string; ip: string | null; userAgent: string | null },
  ): Promise<ApplyResult | null> {
    try {
      return await this.apply(caseId, 'auto', actor);
    } catch (error) {
      this.logger.error(
        `Could not apply playbooks to case ${caseId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  // ------------------------------------------------------------ admin edits

  async upsert(
    input: {
      id?: string;
      name: string;
      description?: string;
      isDefault?: boolean;
      isActive?: boolean;
      matchTags?: string[];
      matchCategories?: string[];
      sortOrder?: number;
      items: { title: string; prompt?: string }[];
    },
    actor: { id: string; ip: string | null; userAgent: string | null },
  ) {
    const data = {
      name: input.name.trim(),
      description: input.description ?? '',
      isDefault: input.isDefault ?? false,
      isActive: input.isActive ?? true,
      matchTags: (input.matchTags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      matchCategories: (input.matchCategories ?? []).map((slug) => slug.trim().toLowerCase()).filter(Boolean),
      sortOrder: input.sortOrder ?? 100,
    };

    const template = input.id
      ? await this.prisma.taskTemplate.update({ where: { id: input.id }, data })
      : await this.prisma.taskTemplate.create({ data: { ...data, createdById: actor.id } });

    // Items are replaced wholesale. Tasks already created from an old item keep
    // their `templateItemId` pointing at nothing, which is harmless: the task
    // and its work log are the record, not the template it came from.
    await this.prisma.taskTemplateItem.deleteMany({ where: { templateId: template.id } });
    await this.prisma.taskTemplateItem.createMany({
      data: input.items
        .filter((item) => item.title.trim())
        .map((item, index) => ({
          templateId: template.id,
          title: item.title.trim(),
          prompt: item.prompt?.trim() ?? '',
          sortOrder: (index + 1) * 10,
        })),
    });

    await this.audit.record({
      action: input.id ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: 'TaskTemplate',
      entityId: template.id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      after: { name: template.name, items: input.items.length, matchTags: data.matchTags },
    });

    return template;
  }

  async remove(id: string, actor: { id: string; ip: string | null; userAgent: string | null }) {
    const template = await this.prisma.taskTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Playbook not found');

    await this.prisma.taskTemplate.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'TaskTemplate',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { name: template.name },
    });
  }
}
