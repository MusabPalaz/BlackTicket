import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { AuditAction, Permission, type RetentionPolicy } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { HousekeepingService } from './housekeeping.service';
import { UpdateRetentionPolicyDto } from './dto/retention.dto';

@ApiTags('admin')
@Controller('admin/settings/retention')
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class RetentionController {
  constructor(
    private readonly housekeeping: HousekeepingService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Current retention policy' })
  get() {
    return this.housekeeping.getPolicy();
  }

  @Get('preview')
  @ApiOperation({ summary: 'What the next sweep would remove, without removing it' })
  preview() {
    return this.housekeeping.preview();
  }

  @Put()
  @ApiOperation({ summary: 'Update the retention policy' })
  async update(
    @Body() dto: UpdateRetentionPolicyDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    const before = await this.housekeeping.getPolicy();
    const after = await this.housekeeping.setPolicy(dto as RetentionPolicy);

    await this.audit.record({
      action: AuditAction.SETTINGS_CHANGED,
      entityType: 'SystemSetting',
      entityId: 'retention.policy',
      actorId: user.id,
      actorIp: request.ip ?? null,
      actorUserAgent: request.get('user-agent') ?? null,
      before,
      after,
    });

    return after;
  }

  /** Runs the sweep now rather than waiting for 4am. */
  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply the retention policy immediately' })
  sweep() {
    return this.housekeeping.sweep();
  }
}
