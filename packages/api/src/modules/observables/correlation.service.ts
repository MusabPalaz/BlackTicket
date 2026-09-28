import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  CaseLinkType,
  type ObservableType,
  formatCaseNumber,
  isWhitelisted,
  type WhitelistRule,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AppEnv } from '../../common/config/env.config';

export interface CorrelationHit {
  caseId: string;
  reference: string;
  title: string;
  status: string;
  severity: string;
  observable: { id: string; type: ObservableType; value: string; normalized: string };
}

/**
 * The correlation engine.
 *
 * One rule: if the same observable appears on two cases, those cases are
 * related. Everything else here exists to keep that rule useful rather than
 * overwhelming.
 */
@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name);

  /** Whitelist rules change rarely and are read on every add; cached briefly. */
  private whitelistCache: { rules: WhitelistRule[]; expiresAt: number } | null = null;
  private static readonly WHITELIST_TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  invalidateWhitelist(): void {
    this.whitelistCache = null;
  }

  async getWhitelist(): Promise<WhitelistRule[]> {
    if (this.whitelistCache && this.whitelistCache.expiresAt > Date.now()) {
      return this.whitelistCache.rules;
    }

    const rows = await this.prisma.correlationWhitelist.findMany({
      select: { type: true, pattern: true, isCidr: true },
    });
    const rules = rows.map((row) => ({
      type: row.type as ObservableType,
      pattern: row.pattern,
      isCidr: row.isCidr,
    }));

    this.whitelistCache = { rules, expiresAt: Date.now() + CorrelationService.WHITELIST_TTL_MS };
    return rules;
  }

  isExcluded(
    observable: { type: ObservableType; normalized: string },
    rules: readonly WhitelistRule[],
  ): boolean {
    return isWhitelisted(observable, rules);
  }

  get fanoutLimit(): number {
    return this.config.get('CORRELATION_FANOUT_LIMIT', { infer: true });
  }

  /**
   * Correlates one observable that was just attached to a case.
   *
   * Two guards keep the graph readable:
   *   * whitelisted indicators (internal ranges, high-noise infrastructure)
   *     never produce links;
   *   * an indicator seen on more cases than the fan-out limit is marked noisy
   *     and stops producing links — otherwise a single `8.8.8.8` would wire
   *     every case to every other and the panel would become worthless.
   */
  async correlateObservable(
    caseId: string,
    observableId: string,
    actor: { id: string; ip: string | null; userAgent: string | null },
  ): Promise<CorrelationHit[]> {
    const observable = await this.prisma.observable.findUnique({ where: { id: observableId } });
    if (!observable) return [];

    const rules = await this.getWhitelist();
    if (
      this.isExcluded(
        { type: observable.type as ObservableType, normalized: observable.normalizedValue },
        rules,
      )
    ) {
      return [];
    }

    const others = await this.prisma.caseObservable.findMany({
      where: { observableId, caseId: { not: caseId }, case: { deletedAt: null } },
      select: {
        case: { select: { id: true, number: true, title: true, status: true, severity: true, createdAt: true } },
      },
      // One more than the limit is enough to know the limit was passed.
      take: this.fanoutLimit + 1,
    });

    if (others.length === 0) return [];

    if (others.length >= this.fanoutLimit) {
      await this.prisma.observable.update({
        where: { id: observableId },
        data: { isNoisy: true },
      });
      this.logger.warn(
        `Observable ${observable.type} ${observable.normalizedValue} exceeds the fan-out limit (${others.length}); no automatic links created`,
      );
      return [];
    }

    const hits: CorrelationHit[] = [];

    for (const entry of others) {
      const other = entry.case;

      // A link may already exist from the other direction; the pair is what
      // matters, not who noticed it first.
      const existing = await this.prisma.caseLink.findFirst({
        where: {
          observableId,
          OR: [
            { sourceCaseId: caseId, targetCaseId: other.id },
            { sourceCaseId: other.id, targetCaseId: caseId },
          ],
        },
        select: { id: true },
      });
      if (existing) continue;

      const reason = `Shared ${observable.type} ${observable.value}`;
      await this.prisma.caseLink.create({
        data: {
          sourceCaseId: caseId,
          targetCaseId: other.id,
          linkType: CaseLinkType.CORRELATED,
          reason,
          observableId,
          isAutomatic: true,
        },
      });

      await this.audit.record({
        action: AuditAction.LINK_CREATED,
        entityType: 'Case',
        entityId: caseId,
        actorId: actor.id,
        actorIp: actor.ip,
        actorUserAgent: actor.userAgent,
        after: { linkedTo: formatCaseNumber(other.number, other.createdAt), reason },
        metadata: { automatic: true, observableId, targetCaseId: other.id },
      });

      hits.push({
        caseId: other.id,
        reference: formatCaseNumber(other.number, other.createdAt),
        title: other.title,
        status: other.status,
        severity: other.severity,
        observable: {
          id: observable.id,
          type: observable.type as ObservableType,
          value: observable.value,
          normalized: observable.normalizedValue,
        },
      });
    }

    return hits;
  }

  /**
   * Everything related to a case: automatic correlations and manual links,
   * grouped per case with the indicators that justify each relationship.
   */
  async relatedCases(caseId: string) {
    const links = await this.prisma.caseLink.findMany({
      where: {
        OR: [{ sourceCaseId: caseId }, { targetCaseId: caseId }],
        sourceCase: { deletedAt: null },
        targetCase: { deletedAt: null },
      },
      include: {
        observable: true,
        createdBy: { select: { id: true, username: true, fullName: true } },
        sourceCase: { select: { id: true, number: true, title: true, status: true, severity: true, resolution: true, createdAt: true } },
        targetCase: { select: { id: true, number: true, title: true, status: true, severity: true, resolution: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const grouped = new Map<
      string,
      {
        case: { id: string; reference: string; title: string; status: string; severity: string; resolution: string | null };
        linkType: string;
        isAutomatic: boolean;
        sharedObservables: { id: string; type: string; value: string }[];
        manualReasons: { reason: string; by: string | null; linkId: string }[];
      }
    >();

    for (const link of links) {
      const other = link.sourceCaseId === caseId ? link.targetCase : link.sourceCase;
      const entry = grouped.get(other.id) ?? {
        case: {
          id: other.id,
          reference: formatCaseNumber(other.number, other.createdAt),
          title: other.title,
          status: other.status,
          severity: other.severity,
          resolution: other.resolution,
        },
        linkType: link.linkType,
        isAutomatic: link.isAutomatic,
        sharedObservables: [],
        manualReasons: [],
      };

      if (link.observable) {
        entry.sharedObservables.push({
          id: link.observable.id,
          type: link.observable.type,
          value: link.observable.value,
        });
      } else {
        entry.manualReasons.push({
          reason: link.reason,
          by: link.createdBy?.fullName ?? null,
          linkId: link.id,
        });
      }

      // A pair joined both automatically and by hand reads as automatic only
      // when nothing manual is attached to it.
      entry.isAutomatic = entry.isAutomatic && link.isAutomatic;
      grouped.set(other.id, entry);
    }

    return { items: [...grouped.values()] };
  }
}
