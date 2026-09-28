import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { SystemService } from './system.service';
import { PurgeDto, PurgeableQueryDto, ResetDataDto } from './dto/admin.dto';
import type { AdminActor } from './users-admin.service';

@ApiTags('admin')
@Controller('admin/system')
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class SystemController {
  constructor(private readonly system: SystemService) {}

  private actor(user: User, request: Request): AdminActor {
    return { id: user.id, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
  }

  @Get('health')
  @ApiOperation({ summary: 'Database reachability, size and the biggest tables' })
  health() {
    return this.system.health();
  }

  @Get('purgeable')
  @ApiOperation({ summary: 'How much each housekeeping target would remove' })
  purgeable(@Query() query: PurgeableQueryDto) {
    return this.system.purgeable(query.olderThanDays ?? 90);
  }

  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Remove rows the product has already retired. The audit trail is not a target: the database refuses to delete from it.',
  })
  purge(@Body() dto: PurgeDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.system.purge(dto.target, dto.olderThanDays ?? 90, this.actor(actor, request));
  }

  @Get('reset-preview')
  @ApiOperation({ summary: 'What a full reset would remove, and what it would keep' })
  resetPreview() {
    return this.system.resetPreview();
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Remove every case, alert and indicator. Accounts and configuration stay. Requires a live code from the authenticator of the account making the call.',
  })
  reset(@Body() dto: ResetDataDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.system.resetOperationalData(this.actor(actor, request), dto.totpCode);
  }
}
