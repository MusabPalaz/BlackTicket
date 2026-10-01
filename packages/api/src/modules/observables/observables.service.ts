import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AuditAction,
  CaseLinkType,
  CaseStatus,
  type ObservableType,
  Tlp,
  formatCaseNumber,
  lookupBlockedReason,
  normalizeObservable,
  refang,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ActorContext } from '../cases/cases.service';
import { CorrelationService, type CorrelationHit } from './correlation.service';
import type {
  CreateCaseLinkDto,
  ObservableInputDto,
  RadarItemDto,
  SearchObservablesDto,
  UpdateCaseObservableDto,
} from './dto/observable.dto';

const OPEN_STATUSES: string[] = [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING];

/** Long enough to carry a verdict's reasoning, short enough for a side panel. */
const SUMMARY_PREVIEW = 280;

const CASE_OBSERVABLE_INCLUDE = {
  observable: true,
  addedBy: { select: { id: true, username: true, fullName: true } },
} satisfies Prisma.CaseObservableInclude;

type CaseObservableRow = Prisma.CaseObservableGetPayload<{
  include: typeof CASE_OBSERVABLE_INCLUDE;
}>;

export interface AddObservablesResult {
  added: ReturnType<typeof ObservablesService.serialize>[];
  /** Already present on this case; adding again is a no-op, not an error. */
  duplicates: { type: string; value: string }[];
  rejected: { type: string; value: string; reason: string }[];
  correlations: CorrelationHit[];
}

@Injectable()
export class ObservablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly correlation: CorrelationService,
  ) {}

  static serialize(row: CaseObservableRow) {
    return {
      id: row.id,
      caseId: row.caseId,
      isIoc: row.isIoc,
      tlp: row.tlp,
      description: row.description,
      addedBy: row.addedBy,
      addedAt: row.addedAt.toISOString(),
      observable: {
        id: row.observable.id,
        type: row.observable.type,
        value: row.observable.value,
        normalized: row.observable.normalizedValue,
        sightingCount: row.observable.sightingCount,
        isNoisy: row.observable.isNoisy,
        firstSeenAt: row.observable.firstSeenAt.toISOString(),
        lastSeenAt: row.observable.lastSeenAt.toISOString(),
      },
    };
  }

  private async openCaseOrThrow(caseId: string) {
    const row = await this.prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('Case not found');
    if (row.status === CaseStatus.CLOSED) {
      throw new BadRequestException('Reopen the case before changing its observables.');
    }
    return row;
  }

  async listForCase(caseId: string) {
    const rows = await this.prisma.caseObservable.findMany({
      where: { caseId },
      include: CASE_OBSERVABLE_INCLUDE,
      orderBy: [{ isIoc: 'desc' }, { addedAt: 'asc' }],
    });
    return { items: rows.map(ObservablesService.serialize) };
  }

  /**
   * Attaches indicators to a case.
   *
   * Each entry is normalised first — the canonical form is what makes two
   * cases collide on the same row. The analyst's original spelling is kept on
   * the Observable so the case still shows what was actually seen.
   */
  async addToCase(
    caseId: string,
    items: ObservableInputDto[],
    actor: ActorContext,
  ): Promise<AddObservablesResult> {
    await this.openCaseOrThrow(caseId);

    const result: AddObservablesResult = {
      added: [],
      duplicates: [],
      rejected: [],
      correlations: [],
    };

    for (const item of items) {
      const normalizeResult = normalizeObservable(item.type, item.value);
      if (!normalizeResult.ok) {
        result.rejected.push({
          type: item.type,
          value: item.value,
          reason: normalizeResult.reason,
        });
        continue;
      }

      const { type, normalized } = normalizeResult.value;
      const now = new Date();

      const observable = await this.prisma.observable.upsert({
        where: { type_normalizedValue: { type, normalizedValue: normalized } },
        update: { lastSeenAt: now },
        create: {
          type,
          value: refang(item.value).trim(),
          normalizedValue: normalized,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });

      const alreadyOnCase = await this.prisma.caseObservable.findUnique({
        where: { caseId_observableId: { caseId, observableId: observable.id } },
      });
      if (alreadyOnCase) {
        result.duplicates.push({ type, value: normalized });
        continue;
      }

      const created = await this.prisma.caseObservable.create({
        data: {
          caseId,
          observableId: observable.id,
          isIoc: item.isIoc ?? false,
          tlp: item.tlp ?? Tlp.AMBER,
          description: item.description ?? null,
          addedById: actor.user.id,
        },
        include: CASE_OBSERVABLE_INCLUDE,
      });

      await this.refreshSightings(observable.id);

      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: 'CaseObservable',
        entityId: created.id,
        actorId: actor.user.id,
        actorIp: actor.ip,
        actorUserAgent: actor.userAgent,
        after: { type, value: normalized, isIoc: created.isIoc },
        metadata: { caseId },
      });

      const hits = await this.correlation.correlateObservable(caseId, observable.id, {
        id: actor.user.id,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      result.correlations.push(...hits);

      const refreshed = await this.prisma.caseObservable.findUniqueOrThrow({
        where: { id: created.id },
        include: CASE_OBSERVABLE_INCLUDE,
      });
      result.added.push(ObservablesService.serialize(refreshed));
    }

    return result;
  }

  /** For a case that stopped counting as a whole, e.g. one that was deleted. */
  async refreshSightingsForCase(caseId: string): Promise<void> {
    const links = await this.prisma.caseObservable.findMany({
      where: { caseId },
      select: { observableId: true },
    });
    for (const link of links) await this.refreshSightings(link.observableId);
  }

  /**
   * Keeps the denormalised counter in step with reality and re-evaluates the
   * noisy flag, which is what suppresses links for ubiquitous indicators.
   */
  private async refreshSightings(observableId: string): Promise<void> {
    const sightingCount = await this.prisma.caseObservable.count({
      where: { observableId, case: { deletedAt: null } },
    });
    await this.prisma.observable.update({
      where: { id: observableId },
      data: { sightingCount, isNoisy: sightingCount > this.correlation.fanoutLimit },
    });
  }

  async updateCaseObservable(id: string, dto: UpdateCaseObservableDto, actor: ActorContext) {
    const existing = await this.prisma.caseObservable.findUnique({
      where: { id },
      include: CASE_OBSERVABLE_INCLUDE,
    });
    if (!existing) throw new NotFoundException('Observable not found on any case');
    await this.openCaseOrThrow(existing.caseId);

    const updated = await this.prisma.caseObservable.update({
      where: { id },
      data: {
        ...(dto.isIoc !== undefined ? { isIoc: dto.isIoc } : {}),
        ...(dto.tlp !== undefined ? { tlp: dto.tlp } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: CASE_OBSERVABLE_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'CaseObservable',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { isIoc: existing.isIoc, tlp: existing.tlp },
      after: { isIoc: updated.isIoc, tlp: updated.tlp },
      metadata: { caseId: existing.caseId },
    });

    return ObservablesService.serialize(updated);
  }

  async removeFromCase(id: string, actor: ActorContext): Promise<void> {
    const existing = await this.prisma.caseObservable.findUnique({
      where: { id },
      include: { observable: true },
    });
    if (!existing) throw new NotFoundException('Observable not found on any case');
    await this.openCaseOrThrow(existing.caseId);

    await this.prisma.caseObservable.delete({ where: { id } });

    // The links this indicator justified no longer have a justification.
    const removedLinks = await this.prisma.caseLink.deleteMany({
      where: {
        observableId: existing.observableId,
        isAutomatic: true,
        OR: [{ sourceCaseId: existing.caseId }, { targetCaseId: existing.caseId }],
      },
    });

    await this.refreshSightings(existing.observableId);

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'CaseObservable',
      entityId: id,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { type: existing.observable.type, value: existing.observable.normalizedValue },
      metadata: { caseId: existing.caseId, removedAutomaticLinks: removedLinks.count },
    });
  }

  /**
   * Global indicator search: has this been seen before, and where?
   *
   * Paged rather than capped. A silent ceiling is the wrong answer on the one
   * screen whose whole job is to say "we have never seen this" — an analyst
   * cannot tell a truncated list from an exhaustive one, and here that
   * difference decides whether an indicator looks new.
   */
  /**
   * What the team already knows about indicators in a case that is still
   * being written — the Case Radar on the new-case screen.
   *
   * For each indicator: whether it was seen before and on how many cases, the
   * last verdict reached on one (resolution and closing summary), and whether
   * correlation would ignore it (whitelisted or noisy). Across all of them:
   * open cases sharing any of the indicators that would link, which is what a
   * duplicate looks like before it is created.
   *
   * Values are normalised here, never taken from the client as-is, and the
   * whitelist and noise rules are the ones correlation itself applies — so the
   * panel cannot promise a link that creating the case would not make.
   */
  async radar(items: RadarItemDto[]) {
    const rules = await this.correlation.getWhitelist();

    const wanted = new Map<string, { type: ObservableType; normalized: string }>();
    for (const item of items) {
      const result = normalizeObservable(item.type, item.value);
      if (!result.ok) continue;
      wanted.set(`${result.value.type}|${result.value.normalized}`, result.value);
    }
    if (wanted.size === 0) return { indicators: [], openCases: [] };

    const known = await this.prisma.observable.findMany({
      where: {
        OR: [...wanted.values()].map((entry) => ({
          type: entry.type,
          normalizedValue: entry.normalized,
        })),
      },
      select: {
        type: true,
        normalizedValue: true,
        sightingCount: true,
        isNoisy: true,
        cases: {
          where: { case: { deletedAt: null } },
          orderBy: { addedAt: 'desc' },
          take: 25,
          select: {
            case: {
              select: {
                id: true,
                number: true,
                title: true,
                status: true,
                severity: true,
                resolution: true,
                summary: true,
                closedAt: true,
                createdAt: true,
                assignee: { select: { fullName: true } },
              },
            },
          },
        },
      },
    });
    const byKey = new Map(known.map((row) => [`${row.type}|${row.normalizedValue}`, row]));

    const openCases = new Map<
      string,
      {
        caseId: string;
        reference: string;
        title: string;
        status: string;
        severity: string;
        assignee: string | null;
        shared: string[];
      }
    >();

    const indicators = [...wanted.entries()].map(([key, entry]) => {
      const row = byKey.get(key);
      const whitelisted = this.correlation.isExcluded(entry, rules);
      const noisy = row?.isNoisy ?? false;
      const cases = row?.cases.map((link) => link.case) ?? [];

      // Only an indicator correlation would act on can make a duplicate.
      if (!whitelisted && !noisy) {
        for (const found of cases) {
          if (!OPEN_STATUSES.includes(found.status)) continue;
          const existing = openCases.get(found.id) ?? {
            caseId: found.id,
            reference: formatCaseNumber(found.number, found.createdAt),
            title: found.title,
            status: found.status,
            severity: found.severity,
            assignee: found.assignee?.fullName ?? null,
            shared: [],
          };
          existing.shared.push(entry.normalized);
          openCases.set(found.id, existing);
        }
      }

      const verdict = cases
        .filter((found) => found.closedAt && found.resolution)
        .sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime())[0];

      return {
        type: entry.type,
        value: entry.normalized,
        sightings: row?.sightingCount ?? 0,
        whitelisted,
        noisy,
        lastVerdict: verdict
          ? {
              caseId: verdict.id,
              reference: formatCaseNumber(verdict.number, verdict.createdAt),
              resolution: verdict.resolution!,
              closedAt: verdict.closedAt!.toISOString(),
              summary:
                verdict.summary && verdict.summary.length > SUMMARY_PREVIEW
                  ? `${verdict.summary.slice(0, SUMMARY_PREVIEW - 1).trimEnd()}…`
                  : verdict.summary,
            }
          : null,
        recent: cases.slice(0, 3).map((found) => ({
          caseId: found.id,
          reference: formatCaseNumber(found.number, found.createdAt),
          title: found.title,
          status: found.status,
          severity: found.severity,
        })),
      };
    });

    return {
      indicators,
      // The case sharing the most indicators is the likeliest duplicate.
      openCases: [...openCases.values()]
        .sort((a, b) => b.shared.length - a.shared.length)
        .slice(0, 3),
    };
  }

  async search(query: SearchObservablesDto) {
    const term = query.q ? refang(query.q).trim().toLowerCase() : '';
    const page = query.page ?? 1;
    const size = query.size ?? 25;

    const where: Prisma.ObservableWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(term ? { normalizedValue: { contains: term } } : {}),
      ...(query.iocOnly === 'true' ? { cases: { some: { isIoc: true } } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.observable.findMany({
        where,
        orderBy: [{ sightingCount: 'desc' }, { lastSeenAt: 'desc' }],
        skip: (page - 1) * size,
        take: size,
        include: {
          cases: {
            where: { case: { deletedAt: null } },
            select: {
              isIoc: true,
              case: {
                select: {
                  id: true,
                  number: true,
                  title: true,
                  status: true,
                  severity: true,
                  createdAt: true,
                },
              },
            },
            orderBy: { addedAt: 'desc' },
            take: 25,
          },
        },
      }),
      this.prisma.observable.count({ where }),
    ]);

    // Checked over every case an indicator is on, not only the 25 listed: one
    // PAP:RED case anywhere is enough to keep it away from outside services.
    const restricted = await this.prisma.caseObservable.findMany({
      where: {
        observableId: { in: rows.map((row) => row.id) },
        case: { deletedAt: null },
        OR: [{ tlp: Tlp.RED }, { case: { pap: Tlp.RED } }],
      },
      select: { observableId: true, tlp: true, case: { select: { pap: true } } },
    });
    const blockedReason = (observableId: string) => {
      for (const entry of restricted) {
        if (entry.observableId !== observableId) continue;
        const reason = lookupBlockedReason({ pap: entry.case.pap as Tlp, tlp: entry.tlp as Tlp });
        if (reason) return reason;
      }
      return null;
    };

    return {
      total,
      page,
      size,
      pages: Math.max(1, Math.ceil(total / size)),
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        value: row.value,
        normalized: row.normalizedValue,
        sightingCount: row.sightingCount,
        isNoisy: row.isNoisy,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        isIoc: row.cases.some((entry) => entry.isIoc),
        lookupBlockedReason: blockedReason(row.id),
        cases: row.cases.map((entry) => ({
          id: entry.case.id,
          reference: formatCaseNumber(entry.case.number, entry.case.createdAt),
          title: entry.case.title,
          status: entry.case.status,
          severity: entry.case.severity,
          isIoc: entry.isIoc,
        })),
      })),
    };
  }

  async sightings(observableId: string) {
    const observable = await this.prisma.observable.findUnique({
      where: { id: observableId },
      include: {
        cases: {
          where: { case: { deletedAt: null } },
          include: {
            case: {
              select: {
                id: true,
                number: true,
                title: true,
                status: true,
                severity: true,
                createdAt: true,
              },
            },
            addedBy: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { addedAt: 'desc' },
        },
      },
    });
    if (!observable) throw new NotFoundException('Observable not found');

    return {
      observable: {
        id: observable.id,
        type: observable.type,
        value: observable.value,
        normalized: observable.normalizedValue,
        sightingCount: observable.sightingCount,
        isNoisy: observable.isNoisy,
      },
      items: observable.cases.map((entry) => ({
        caseId: entry.case.id,
        reference: formatCaseNumber(entry.case.number, entry.case.createdAt),
        title: entry.case.title,
        status: entry.case.status,
        severity: entry.case.severity,
        isIoc: entry.isIoc,
        addedBy: entry.addedBy,
        addedAt: entry.addedAt.toISOString(),
      })),
    };
  }

  // ----------------------------------------------------------- manual links

  async createLink(caseId: string, dto: CreateCaseLinkDto, actor: ActorContext) {
    if (dto.targetCaseId === caseId) {
      throw new BadRequestException('A case cannot be linked to itself.');
    }

    const [source, target] = await Promise.all([
      this.prisma.case.findFirst({ where: { id: caseId, deletedAt: null }, select: { id: true } }),
      this.prisma.case.findFirst({
        where: { id: dto.targetCaseId, deletedAt: null },
        select: { id: true, number: true, createdAt: true },
      }),
    ]);
    if (!source || !target) throw new NotFoundException('Case not found');

    const existing = await this.prisma.caseLink.findFirst({
      where: {
        observableId: null,
        OR: [
          { sourceCaseId: caseId, targetCaseId: target.id },
          { sourceCaseId: target.id, targetCaseId: caseId },
        ],
      },
    });
    if (existing) {
      throw new BadRequestException('These cases are already linked.');
    }

    const link = await this.prisma.caseLink.create({
      data: {
        sourceCaseId: caseId,
        targetCaseId: target.id,
        linkType: dto.linkType ?? CaseLinkType.RELATED,
        reason: dto.reason.trim(),
        isAutomatic: false,
        createdById: actor.user.id,
      },
    });

    await this.audit.record({
      action: AuditAction.LINK_CREATED,
      entityType: 'Case',
      entityId: caseId,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      after: { linkedTo: formatCaseNumber(target.number, target.createdAt), reason: link.reason },
      metadata: { automatic: false, targetCaseId: target.id },
    });

    return { id: link.id, linkType: link.linkType, reason: link.reason };
  }

  async removeLink(caseId: string, linkId: string, actor: ActorContext): Promise<void> {
    const link = await this.prisma.caseLink.findUnique({ where: { id: linkId } });
    if (!link || (link.sourceCaseId !== caseId && link.targetCaseId !== caseId)) {
      throw new NotFoundException('Link not found on this case');
    }

    await this.prisma.caseLink.delete({ where: { id: linkId } });

    await this.audit.record({
      action: AuditAction.LINK_REMOVED,
      entityType: 'Case',
      entityId: caseId,
      actorId: actor.user.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { reason: link.reason, automatic: link.isAutomatic },
      metadata: { linkId, targetCaseId: link.targetCaseId },
    });
  }
}
