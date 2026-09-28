import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { AuditAction, Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { UpdateSlaMonitoringDto, UpdateSlaPolicyDto, UpsertCategoryDto } from './dto/admin.dto';

@ApiTags('admin')
@Controller('admin')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private context(user: User, request: Request) {
    return {
      actorId: user.id,
      actorIp: request.ip ?? null,
      actorUserAgent: request.get('user-agent') ?? null,
    };
  }

  // ------------------------------------------------------------- categories

  @Get('categories')
  @RequirePermissions(Permission.TAXONOMY_MANAGE)
  @ApiOperation({ summary: 'All case categories, including the inactive ones' })
  async categories() {
    const items = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { items };
  }

  @Post('categories')
  @RequirePermissions(Permission.TAXONOMY_MANAGE)
  @ApiOperation({ summary: 'Create or update a category by slug' })
  async upsertCategory(
    @Body() dto: UpsertCategoryDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    const slug = dto.slug.trim().toLowerCase();
    const before = await this.prisma.category.findUnique({ where: { slug } });

    // Categories are referenced by cases, so they are deactivated rather than
    // deleted: an old case must keep the label it was filed under.
    const category = await this.prisma.category.upsert({
      where: { slug },
      update: {
        name: dto.name.trim(),
        ...(dto.color ? { color: dto.color } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      create: {
        slug,
        name: dto.name.trim(),
        color: dto.color ?? '#64748b',
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 500,
      },
    });

    await this.audit.record({
      ...this.context(user, request),
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: 'Category',
      entityId: category.id,
      before: before ? { name: before.name, isActive: before.isActive } : undefined,
      after: { name: category.name, isActive: category.isActive },
    });

    return category;
  }

  // ----------------------------------------------------------- SLA policies

  @Get('sla-policies')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'First-response and resolution targets per severity' })
  async slaPolicies() {
    const items = await this.prisma.slaPolicy.findMany({ orderBy: { severity: 'asc' } });
    return { items };
  }

  @Patch('sla-policies')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Change a severity target. Applies to cases opened from now on.' })
  async updateSlaPolicy(
    @Body() dto: UpdateSlaPolicyDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    const before = await this.prisma.slaPolicy.findUnique({ where: { severity: dto.severity } });

    const policy = await this.prisma.slaPolicy.upsert({
      where: { severity: dto.severity },
      update: {
        firstResponseMinutes: dto.firstResponseMinutes,
        resolutionMinutes: dto.resolutionMinutes,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      create: {
        severity: dto.severity,
        firstResponseMinutes: dto.firstResponseMinutes,
        resolutionMinutes: dto.resolutionMinutes,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.record({
      ...this.context(user, request),
      action: AuditAction.SETTINGS_CHANGED,
      entityType: 'SlaPolicy',
      entityId: policy.id,
      before: before
        ? {
            firstResponseMinutes: before.firstResponseMinutes,
            resolutionMinutes: before.resolutionMinutes,
          }
        : undefined,
      after: {
        firstResponseMinutes: policy.firstResponseMinutes,
        resolutionMinutes: policy.resolutionMinutes,
      },
      // Existing cases keep the deadline they were given; changing a policy
      // must not silently rewrite history.
      metadata: { appliesTo: 'cases created after this change' },
    });

    return policy;
  }

  // -------------------------------------------------------- SLA monitoring

  @Get('sla-monitoring')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Whether the SLA sweep runs, and whether it notifies' })
  slaMonitoring() {
    return this.settings.getSlaMonitoringPolicy();
  }

  @Patch('sla-monitoring')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({
    summary:
      'Turn the sweep or its notifications on and off. Off keeps existing breach flags; it does not clear them.',
  })
  async updateSlaMonitoring(
    @Body() dto: UpdateSlaMonitoringDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    const before = await this.settings.getSlaMonitoringPolicy();
    const after = await this.settings.setSlaMonitoringPolicy({
      enabled: dto.enabled ?? before.enabled,
      notifications: dto.notifications ?? before.notifications,
      updatedAt: new Date().toISOString(),
      updatedById: user.id,
    });

    await this.audit.record({
      ...this.context(user, request),
      action: AuditAction.SETTINGS_CHANGED,
      entityType: 'SlaMonitoring',
      entityId: 'sla.monitoring',
      before: { enabled: before.enabled, notifications: before.notifications },
      after: { enabled: after.enabled, notifications: after.notifications },
    });

    return after;
  }
}
