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
import type { ActorContext } from '../cases/cases.service';
import { ObservablesService } from './observables.service';
import { CorrelationService } from './correlation.service';
import {
  AddObservablesDto,
  CreateCaseLinkDto,
  SearchObservablesDto,
  UpdateCaseObservableDto,
} from './dto/observable.dto';

function actorOf(user: User, request: Request): ActorContext {
  return { user, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
}

@ApiTags('observables')
@Controller()
export class ObservablesController {
  constructor(
    private readonly observables: ObservablesService,
    private readonly correlation: CorrelationService,
  ) {}

  @Get('cases/:caseId/observables')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Observables attached to a case' })
  list(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.observables.listForCase(caseId);
  }

  @Post('cases/:caseId/observables')
  @RequirePermissions(Permission.OBSERVABLE_MANAGE)
  @ApiOperation({
    summary: 'Attach observables; each is normalised and correlated on the way in',
  })
  add(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: AddObservablesDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.observables.addToCase(caseId, dto.items, actorOf(user, request));
  }

  @Patch('case-observables/:id')
  @RequirePermissions(Permission.OBSERVABLE_MANAGE)
  @ApiOperation({ summary: 'Change the IOC flag, TLP or note of one attachment' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseObservableDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.observables.updateCaseObservable(id, dto, actorOf(user, request));
  }

  @Delete('case-observables/:id')
  @RequirePermissions(Permission.OBSERVABLE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Detach an observable and drop the links it justified' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    await this.observables.removeFromCase(id, actorOf(user, request));
  }

  @Get('observables/search')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Global indicator search across every case' })
  search(@Query() query: SearchObservablesDto) {
    return this.observables.search(query);
  }

  @Get('observables/:id/sightings')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Every case an indicator has appeared on' })
  sightings(@Param('id', ParseUUIDPipe) id: string) {
    return this.observables.sightings(id);
  }

  @Get('cases/:caseId/related')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Correlated and manually linked cases' })
  related(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.correlation.relatedCases(caseId);
  }

  @Post('cases/:caseId/links')
  @RequirePermissions(Permission.CASE_LINK)
  @ApiOperation({ summary: 'Link two cases by hand' })
  createLink(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CreateCaseLinkDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.observables.createLink(caseId, dto, actorOf(user, request));
  }

  @Delete('cases/:caseId/links/:linkId')
  @RequirePermissions(Permission.CASE_LINK)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a link between two cases' })
  async removeLink(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    await this.observables.removeLink(caseId, linkId, actorOf(user, request));
  }
}
