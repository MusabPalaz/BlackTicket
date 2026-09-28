import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from './metrics.service';

class PreferencesDto {
  @IsObject()
  preferences!: Record<string, unknown>;
}

/** Clamps a caller-supplied window to something the database can serve cheaply. */
function windowDays(value: string | undefined, fallback = 14): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

function limitOf(value: string | undefined, fallback = 10): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, Math.round(parsed)));
}

@ApiTags('metrics')
@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('metrics/case-trend')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Cases opened and closed per day' })
  caseTrend(@Query('days') days?: string) {
    return this.metrics.caseTrend(windowDays(days));
  }

  @Get('metrics/open-by-severity')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Open cases grouped by severity' })
  openBySeverity() {
    return this.metrics.openBySeverity();
  }

  @Get('metrics/by-status')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'All cases grouped by status' })
  byStatus() {
    return this.metrics.openByStatus();
  }

  @Get('metrics/sla')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'SLA compliance over a window' })
  sla(@Query('days') days?: string) {
    return this.metrics.slaCompliance(windowDays(days, 30));
  }

  @Get('metrics/resolution-time')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Mean hours from incident to close, per severity' })
  resolutionTime(@Query('days') days?: string) {
    return this.metrics.resolutionTime(windowDays(days, 30));
  }

  @Get('metrics/workload')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Open cases per analyst' })
  workload() {
    return this.metrics.workload();
  }

  @Get('metrics/alerts-by-status')
  @RequirePermissions(Permission.ALERT_READ)
  @ApiOperation({ summary: 'Alert queue by status' })
  alertsByStatus() {
    return this.metrics.alertsByStatus();
  }

  @Get('metrics/alerts-by-source')
  @RequirePermissions(Permission.ALERT_READ)
  @ApiOperation({ summary: 'Alert volume by source system' })
  alertsBySource(@Query('days') days?: string) {
    return this.metrics.alertsBySource(windowDays(days));
  }

  @Get('metrics/top-tags')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Most used case tags' })
  topTags(@Query('limit') limit?: string) {
    return this.metrics.topTags(limitOf(limit));
  }

  @Get('metrics/top-observables')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Indicators seen on the most cases' })
  topObservables(@Query('limit') limit?: string) {
    return this.metrics.topObservables(limitOf(limit));
  }

  @Get('metrics/due-soon')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Open cases by deadline' })
  dueSoon(@Query('limit') limit?: string) {
    return this.metrics.dueSoon(limitOf(limit, 8));
  }

  @Get('metrics/mitre-coverage')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Most frequently tagged ATT&CK techniques' })
  mitreCoverage(@Query('limit') limit?: string) {
    return this.metrics.mitreCoverage(limitOf(limit));
  }

  // --------------------------------------------------------- own preferences

  @Get('me/preferences')
  @ApiOperation({ summary: 'Own UI preferences, currently the dashboard layout' })
  async getPreferences(@CurrentUser() user: User) {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { preferences: true },
    });
    return { preferences: row?.preferences ?? {} };
  }

  @Put('me/preferences')
  @ApiOperation({ summary: 'Replace own UI preferences' })
  async setPreferences(@CurrentUser() user: User, @Body() dto: PreferencesDto) {
    // Stored whole and never queried by content, so no schema is enforced —
    // but the size is, so a client cannot use the column as free storage.
    const serialized = JSON.stringify(dto.preferences);
    if (serialized.length > 32_768) {
      return { preferences: {}, error: 'Preferences payload is too large.' };
    }

    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: { preferences: dto.preferences as never },
      select: { preferences: true },
    });
    return { preferences: row.preferences };
  }
}
