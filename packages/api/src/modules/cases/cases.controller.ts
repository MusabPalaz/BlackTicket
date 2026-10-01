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
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { CasesService, type ActorContext } from './cases.service';
import { AttackMapService } from './attack-map.service';
import {
  AssignCaseDto,
  ChangeStatusDto,
  CloseCaseDto,
  CreateCaseDto,
  ListCasesQueryDto,
  SetMitreDto,
  UpdateCaseDto,
} from './dto/case.dto';

@ApiTags('cases')
@Controller('cases')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly attackMap: AttackMapService,
  ) {}

  private actor(user: User, request: Request): ActorContext {
    return { user, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
  }

  @Get()
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'List cases with filters, search and pagination' })
  list(@Query() query: ListCasesQueryDto) {
    return this.cases.list(query);
  }

  @Get('summary')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Counters for the dashboard' })
  summary(@CurrentUser() user: User) {
    return this.cases.summary(user.id);
  }

  @Post()
  @RequirePermissions(Permission.CASE_CREATE)
  @ApiOperation({ summary: 'Open a new case' })
  create(@Body() dto: CreateCaseDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.cases.create(dto, this.actor(user, request));
  }

  @Get(':id')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Full case detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.cases.getById(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CASE_UPDATE_OWN)
  @ApiOperation({ summary: 'Edit case fields (ownership is checked in the service)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.cases.update(id, dto, this.actor(user, request));
  }

  @Post(':id/assign')
  @RequirePermissions(Permission.CASE_ASSIGN_SELF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or unassign; analysts may only take cases themselves' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCaseDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.cases.assign(id, dto, this.actor(user, request));
  }

  @Post(':id/status')
  @RequirePermissions(Permission.CASE_UPDATE_OWN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move the case through the workflow' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.cases.changeStatus(id, dto.status, this.actor(user, request));
  }

  @Post(':id/close')
  @RequirePermissions(Permission.CASE_CLOSE_OWN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close with a resolution and a closing summary' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCaseDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.cases.close(id, dto.resolution, dto.summary, this.actor(user, request));
  }

  @Post(':id/reopen')
  @RequirePermissions(Permission.CASE_CLOSE_OWN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a closed case' })
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() request: Request) {
    return this.cases.reopen(id, this.actor(user, request));
  }

  @Delete(':id')
  @RequirePermissions(Permission.CASE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a case (administrators only)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() request: Request) {
    await this.cases.softDelete(id, this.actor(user, request));
  }

  @Get(':id/attack-map')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({
    summary: 'The campaign a case belongs to, laid out on the kill chain, and what tends to follow',
  })
  attackMapOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.attackMap.build(id);
  }

  @Get(':id/timeline')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Merged audit trail and analyst notes, newest first' })
  timeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.cases.timeline(id);
  }

  @Post(':id/mitre')
  @RequirePermissions(Permission.CASE_UPDATE_OWN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace the MITRE ATT&CK techniques on a case' })
  setMitre(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMitreDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.cases.setMitre(id, dto.techniqueIds, this.actor(user, request));
  }
}
