import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission, Role } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { UsersService } from '../users/users.service';
import { UsersAdminService, type AdminActor } from './users-admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { BulkUsersDto, ImportUsersDto, ListUsersQueryDto, UpdateUserDto } from './dto/admin.dto';

@ApiTags('admin')
@Controller('admin/users')
@RequirePermissions(Permission.USER_MANAGE)
export class UsersAdminController {
  constructor(
    private readonly users: UsersService,
    private readonly admin: UsersAdminService,
  ) {}

  private actor(user: User, request: Request): AdminActor {
    return { id: user.id, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
  }

  @Get()
  @ApiOperation({ summary: 'List accounts' })
  list(@Query() query: ListUsersQueryDto) {
    return this.admin.list(query);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Labels in use across accounts, with how many carry each' })
  tags() {
    return this.admin.tagsInUse();
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Apply one reversible action to a selection. Accounts that cannot be changed are reported, not skipped silently.',
  })
  bulk(@Body() dto: BulkUsersDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.admin.bulk(dto, this.actor(actor, request));
  }

  // Declared after the literal routes above: ':id' would otherwise match them.
  @Get(':id')
  @ApiOperation({ summary: 'Account detail with sessions, workload and recent activity' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.detail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an account (subject to the organisation domain policy)' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.users.create(dto, this.actor(actor, request));
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk import from CSV. Defaults to a dry run so a 600-row file can be checked first.',
  })
  import(@Body() dto: ImportUsersDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.admin.importCsv(
      dto.csv,
      { dryRun: dto.dryRun ?? true, defaultRole: dto.defaultRole ?? Role.ANALYST },
      this.actor(actor, request),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update name, e-mail, role or status' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    return this.admin.update(id, dto, this.actor(actor, request));
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable an account and end its sessions' })
  disable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    return this.admin.setEnabled(id, false, this.actor(actor, request));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-enable an account and clear its lockout' })
  enable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    return this.admin.setEnabled(id, true, this.actor(actor, request));
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue a temporary password; shown once, must be changed at next sign-in',
  })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    return this.admin.resetPassword(id, this.actor(actor, request));
  }

  @Post(':id/force-logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session of this account' })
  forceLogout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    return this.admin.forceLogout(id, this.actor(actor, request));
  }

  @Post(':id/reset-2fa')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear two-factor authentication (lost device recovery)' })
  async resetTotp(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    await this.admin.resetTotp(id, this.actor(actor, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an account with no open cases' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    await this.admin.softDelete(id, this.actor(actor, request));
  }
}
