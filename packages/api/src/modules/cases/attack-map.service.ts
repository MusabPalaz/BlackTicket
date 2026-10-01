import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ATTACK_TACTICS, formatCaseNumber, tacticIndex } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** How far the campaign is followed from the case, in links. */
const MAX_DEPTH = 3;
/** Beyond this a map stops being readable; the response says it was cut. */
const MAX_CASES = 40;
const MAX_PREDICTIONS = 4;

interface Technique {
  id: string;
  name: string;
  tactic: string;
}

/**
 * The attack map of a case: the campaign it belongs to, and what tends to come
 * next.
 *
 * The campaign is everything reachable through case links — shared indicators
 * and the links analysts made by hand — up to a few steps out. Each case is
 * placed by when it happened and by the ATT&CK tactics tagged on it.
 *
 * "What comes next" is answered twice, and the two are kept apart:
 *
 *  - from this team's own history: wherever cases carrying these techniques
 *    were linked to a later case, which techniques did that later case carry?
 *    Counted over other campaigns only, so a campaign cannot confirm itself;
 *  - from the ATT&CK kill chain: the tactics that follow the furthest stage
 *    seen so far, with the techniques this team tags most often under them.
 *
 * Both are evidence, not forecasts, and every figure says what it rests on.
 */
@Injectable()
export class AttackMapService {
  constructor(private readonly prisma: PrismaService) {}

  async build(caseId: string) {
    const origin = await this.prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true },
    });
    if (!origin) throw new NotFoundException('Case not found');

    const { depthOf, links, truncated } = await this.walk(caseId);
    const ids = [...depthOf.keys()];

    const rows = await this.prisma.case.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        severity: true,
        resolution: true,
        occurredAt: true,
        createdAt: true,
        mitre: { select: { technique: { select: { id: true, name: true, tactic: true } } } },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const cases = rows.map((row) => ({
      id: row.id,
      reference: formatCaseNumber(row.number, row.createdAt),
      title: row.title,
      status: row.status,
      severity: row.severity,
      resolution: row.resolution,
      occurredAt: row.occurredAt.toISOString(),
      depth: depthOf.get(row.id) ?? 0,
      techniques: row.mitre
        .map((entry) => entry.technique)
        .sort((a, b) => tacticIndex(a.tactic) - tacticIndex(b.tactic)),
    }));

    const current = cases.find((entry) => entry.id === caseId);
    const tactics = ATTACK_TACTICS.map((tactic) => ({
      tactic: tactic.name,
      short: tactic.short,
      cases: cases.filter((entry) => entry.techniques.some((t) => t.tactic === tactic.name)).length,
      current: Boolean(current?.techniques.some((t) => t.tactic === tactic.name)),
    }));

    const seen = new Map<string, Technique>();
    for (const entry of cases)
      for (const technique of entry.techniques) seen.set(technique.id, technique);

    const furthest = Math.max(-1, ...[...seen.values()].map((t) => tacticIndex(t.tactic)));

    return {
      caseId,
      cases,
      links: links.filter((link) => depthOf.has(link.source) && depthOf.has(link.target)),
      truncated,
      tactics,
      predictions: {
        history: await this.fromHistory(ids, [...seen.keys()], furthest),
        framework: await this.fromKillChain(furthest, new Set(seen.keys())),
      },
    };
  }

  /** Breadth-first over case links, closest cases first. */
  private async walk(caseId: string) {
    const depthOf = new Map<string, number>([[caseId, 0]]);
    const edges = new Map<
      string,
      { source: string; target: string; indicators: Set<string>; manual: Set<string> }
    >();
    let frontier = [caseId];
    let truncated = false;

    for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth += 1) {
      const found = await this.prisma.caseLink.findMany({
        where: {
          OR: [{ sourceCaseId: { in: frontier } }, { targetCaseId: { in: frontier } }],
          sourceCase: { deletedAt: null },
          targetCase: { deletedAt: null },
        },
        select: {
          sourceCaseId: true,
          targetCaseId: true,
          isAutomatic: true,
          reason: true,
          observable: { select: { normalizedValue: true } },
        },
        take: 2_000,
      });

      const next: string[] = [];
      for (const link of found) {
        const [source, target] = [link.sourceCaseId, link.targetCaseId].sort() as [string, string];
        const key = `${source}|${target}`;
        const edge = edges.get(key) ?? { source, target, indicators: new Set(), manual: new Set() };
        if (link.isAutomatic && link.observable)
          edge.indicators.add(link.observable.normalizedValue);
        else edge.manual.add(link.reason);
        edges.set(key, edge);

        for (const other of [link.sourceCaseId, link.targetCaseId]) {
          if (depthOf.has(other)) continue;
          if (depthOf.size >= MAX_CASES) {
            truncated = true;
            continue;
          }
          depthOf.set(other, depth);
          next.push(other);
        }
      }
      frontier = next;
    }

    const links = [...edges.values()].map((edge) => ({
      source: edge.source,
      target: edge.target,
      indicators: [...edge.indicators],
      manual: [...edge.manual],
    }));
    return { depthOf, links, truncated };
  }

  /**
   * Techniques that followed these ones elsewhere: for every pair of linked
   * cases outside this campaign, the earlier one carrying any of `seeds`, the
   * techniques on the later one that are not already in play.
   */
  private async fromHistory(campaign: string[], seeds: string[], furthest: number) {
    if (seeds.length === 0) return { basedOn: 0, items: [] };

    const pairs = Prisma.sql`
      WITH pairs AS (
        SELECT DISTINCT
          CASE WHEN a."occurredAt" <= b."occurredAt" THEN a.id ELSE b.id END AS early,
          CASE WHEN a."occurredAt" <= b."occurredAt" THEN b.id ELSE a.id END AS late
        FROM case_link l
        JOIN "case" a ON a.id = l."sourceCaseId"
        JOIN "case" b ON b.id = l."targetCaseId"
        WHERE a."deletedAt" IS NULL AND b."deletedAt" IS NULL AND a.id <> b.id
          AND a.id <> ALL(${campaign}::uuid[]) AND b.id <> ALL(${campaign}::uuid[])
      ),
      seeded AS (
        SELECT DISTINCT p.early, p.late
        FROM pairs p
        JOIN case_mitre m ON m."caseId" = p.early AND m."techniqueId" = ANY(${seeds}::text[])
      )`;

    const [basis] = await this.prisma.$queryRaw<{ total: number }[]>`
      ${pairs}
      SELECT COUNT(DISTINCT early)::int AS total FROM seeded`;

    const followed = await this.prisma.$queryRaw<
      { technique: string; cases: number; examples: string[] }[]
    >`
      ${pairs}
      SELECT m."techniqueId" AS technique,
             COUNT(DISTINCT s.late)::int AS cases,
             (array_agg(DISTINCT s.late::text))[1:3] AS examples
      FROM seeded s
      JOIN case_mitre m ON m."caseId" = s.late AND m."techniqueId" <> ALL(${seeds}::text[])
      GROUP BY m."techniqueId"
      ORDER BY cases DESC
      LIMIT 12`;

    if (followed.length === 0) return { basedOn: basis?.total ?? 0, items: [] };

    const techniques = await this.prisma.mitreTechnique.findMany({
      where: { id: { in: followed.map((row) => row.technique) } },
      select: { id: true, name: true, tactic: true },
    });
    const exampleCases = await this.prisma.case.findMany({
      where: { id: { in: followed.flatMap((row) => row.examples) } },
      select: { id: true, number: true, createdAt: true },
    });

    const items = followed
      .map((row) => {
        const technique = techniques.find((t) => t.id === row.technique);
        return {
          techniqueId: row.technique,
          name: technique?.name ?? row.technique,
          tactic: technique?.tactic ?? '',
          cases: row.cases,
          examples: row.examples.flatMap((id) => {
            const found = exampleCases.find((entry) => entry.id === id);
            return found
              ? [{ caseId: id, reference: formatCaseNumber(found.number, found.createdAt) }]
              : [];
          }),
        };
      })
      // Equal counts favour what lies ahead of the campaign over what lies behind.
      .sort(
        (a, b) =>
          b.cases - a.cases ||
          Number(tacticIndex(b.tactic) > furthest) - Number(tacticIndex(a.tactic) > furthest),
      )
      .slice(0, MAX_PREDICTIONS);

    return { basedOn: basis?.total ?? 0, items };
  }

  /**
   * The next two kill-chain stages after the furthest one reached, each with
   * the techniques this team tags most under it — or, with no history, the
   * first ones in the catalogue.
   */
  private async fromKillChain(furthest: number, inPlay: Set<string>) {
    const start = furthest < 0 ? tacticIndex('Initial Access') : furthest + 1;
    const stages = ATTACK_TACTICS.slice(start, start + 2).map((tactic) => tactic.name);
    if (stages.length === 0) return [];

    const catalogue = await this.prisma.mitreTechnique.findMany({
      where: { tactic: { in: stages }, isActive: true },
      select: {
        id: true,
        name: true,
        tactic: true,
        _count: { select: { cases: { where: { case: { deletedAt: null } } } } },
      },
    });

    return stages.map((tactic) => ({
      tactic,
      techniques: catalogue
        .filter((t) => t.tactic === tactic && !inPlay.has(t.id))
        .sort((a, b) => b._count.cases - a._count.cases || a.id.localeCompare(b.id))
        .slice(0, 3)
        .map((t) => ({ id: t.id, name: t.name, timesTagged: t._count.cases })),
    }));
  }
}
