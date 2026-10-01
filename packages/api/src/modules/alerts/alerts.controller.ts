import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { ActorContext } from '../cases/cases.service';
import { AlertsService } from './alerts.service';
import { SlaService } from '../sla/sla.service';
import {
  IgnoreAlertDto,
  ImportAlertDto,
  ListAlertsQueryDto,
  MergeAlertDto,
  RestoreAlertDto,
} from './dto/alert.dto';

function actorOf(user: User, request: Request): ActorContext {
  return { user, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
}

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly sla: SlaService,
  ) {}

  @Get()
  @RequirePermissions(Permission.ALERT_READ)
  @ApiOperation({ summary: 'The triage queue' })
  list(@Query() query: ListAlertsQueryDto) {
    return this.alerts.list(query);
  }

  @Get('summary')
  @RequirePermissions(Permission.ALERT_READ)
  @ApiOperation({ summary: 'Queue counts and SLA pressure for the dashboard' })
  async summary() {
    const [counts, sla, oldest] = await Promise.all([
      this.alerts.counts(),
      this.sla.pressure(),
      this.alerts.oldestUntriaged(),
    ]);
    return { alerts: counts, sla, oldestUntriagedAt: oldest };
  }

  @Get(':id')
  @RequirePermissions(Permission.ALERT_READ)
  @ApiOperation({ summary: 'One alert, including the raw payload' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.getById(id);
  }

  @Post(':id/import')
  @RequirePermissions(Permission.ALERT_IMPORT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a case from this alert, carrying its indicators across' })
  import(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportAlertDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.alerts.importToCase(id, dto, actorOf(user, request));
  }

  @Post(':id/merge')
  @RequirePermissions(Permission.ALERT_IMPORT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fold this alert into an existing case' })
  merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeAlertDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.alerts.mergeIntoCase(id, dto.caseId, actorOf(user, request));
  }

  @Post(':id/ignore')
  @RequirePermissions(Permission.ALERT_IGNORE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss an alert with a reason' })
  ignore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IgnoreAlertDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.alerts.ignore(id, dto, actorOf(user, request));
  }

  @Post(':id/restore')
  @RequirePermissions(Permission.ALERT_IGNORE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put an ignored alert back in the triage queue' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestoreAlertDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.alerts.restore(id, dto, actorOf(user, request));
  }
}
