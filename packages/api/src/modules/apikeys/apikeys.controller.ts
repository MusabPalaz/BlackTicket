import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ApiKeysService } from './apikeys.service';
import { CreateApiKeyDto } from '../alerts/dto/alert.dto';

@ApiTags('admin')
@Controller('admin/api-keys')
@RequirePermissions(Permission.API_KEY_MANAGE)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'Ingest keys; only the prefix of each is stored in readable form' })
  list() {
    return this.apiKeys.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a key. The full value is returned once and never again.' })
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.apiKeys.create(dto, {
      id: user.id,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a key immediately' })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() request: Request) {
    await this.apiKeys.revoke(id, {
      id: user.id,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
  }

  @Delete(':id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a revoked or expired key outright; the audit entry remains' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() request: Request) {
    await this.apiKeys.remove(id, {
      id: user.id,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
  }
}
