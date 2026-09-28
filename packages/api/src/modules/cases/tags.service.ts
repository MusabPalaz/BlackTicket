import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The tag vocabulary offered to analysts.
 *
 * Case tags remain free text — nobody should be blocked from filing a case
 * because the right word is missing — but every tag typed by hand is registered
 * here with a usage count, so the picker learns the team's actual vocabulary
 * instead of leaving everyone to invent "phish", "phishing" and "Phishing".
 */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query?: string) {
    const term = query?.trim().toLowerCase();

    const items = await this.prisma.tag.findMany({
      where: term ? { name: { contains: term } } : {},
      orderBy: [{ isSuggested: 'desc' }, { usageCount: 'desc' }, { name: 'asc' }],
      take: 100,
    });

    return {
      items: items.map((tag) => ({
        name: tag.name,
        description: tag.description,
        color: tag.color,
        isSuggested: tag.isSuggested,
        usageCount: tag.usageCount,
      })),
    };
  }

  /** Called whenever a case's tags are written. Never blocks the write. */
  async register(tags: string[]): Promise<void> {
    for (const raw of new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))) {
      await this.prisma.tag.upsert({
        where: { name: raw },
        update: { usageCount: { increment: 1 } },
        create: { name: raw, usageCount: 1, isSuggested: false },
      });
    }
  }

  async upsertSuggested(
    input: { name: string; description?: string; color?: string; isSuggested?: boolean },
  ) {
    const name = input.name.trim().toLowerCase();
    return this.prisma.tag.upsert({
      where: { name },
      update: {
        description: input.description,
        color: input.color,
        ...(input.isSuggested !== undefined ? { isSuggested: input.isSuggested } : {}),
      },
      create: {
        name,
        description: input.description,
        color: input.color ?? '#64748b',
        isSuggested: input.isSuggested ?? true,
      },
    });
  }

  async remove(name: string): Promise<void> {
    await this.prisma.tag.deleteMany({ where: { name: name.trim().toLowerCase() } });
  }
}
