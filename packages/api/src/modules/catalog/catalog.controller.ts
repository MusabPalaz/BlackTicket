import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@black-ticket/shared';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Read-only reference data the case forms need: categories, MITRE techniques
 * and the people a case can be assigned to. Managing these lives elsewhere;
 * this is what every authenticated analyst is allowed to read.
 */
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('categories')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Active case categories' })
  async categories() {
    const items = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, color: true },
    });
    return { items };
  }

  @Get('mitre/techniques')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Search MITRE ATT&CK techniques by id, name or tactic' })
  async techniques(@Query('q') q?: string) {
    const term = q?.trim();
    const items = await this.prisma.mitreTechnique.findMany({
      where: {
        isActive: true,
        ...(term
          ? {
              OR: [
                { id: { contains: term, mode: 'insensitive' as const } },
                { name: { contains: term, mode: 'insensitive' as const } },
                { tactic: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ tactic: 'asc' }, { id: 'asc' }],
      take: 50,
      select: { id: true, name: true, tactic: true, url: true },
    });
    return { items };
  }

  @Get('users/assignable')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Accounts that can own a case' })
  async assignableUsers() {
    const items = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
        role: { not: 'READ_ONLY' },
      },
      orderBy: { fullName: 'asc' },
      select: { id: true, username: true, fullName: true, role: true },
    });
    return { items };
  }
}
