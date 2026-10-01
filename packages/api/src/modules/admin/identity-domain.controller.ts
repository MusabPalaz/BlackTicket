import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ReauthThrottleGuard } from '../../common/guards/reauth-throttle.guard';
import { IdentityDomainService } from './identity-domain.service';
import {
  AddIdentityDomainDto,
  LockIdentityDomainDto,
  SetIdentityDomainDto,
  UnlockIdentityDomainDto,
} from './dto/identity-domain.dto';

@ApiTags('admin')
@Controller('admin/settings/identity-domain')
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class IdentityDomainController {
  constructor(private readonly domains: IdentityDomainService) {}

  private actorOf(user: User, request: Request) {
    return { id: user.id, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
  }

  @Get()
  @ApiOperation({ summary: 'Current organisation e-mail domain policy' })
  get() {
    return this.domains.view();
  }

  @Put()
  @ApiOperation({ summary: 'Set or change the organisation domain (blocked while locked)' })
  set(@Body() dto: SetIdentityDomainDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.domains.setDomain(dto.domain, dto.confirmDomain, this.actorOf(user, request));
  }

  @Post('domains')
  @ApiOperation({ summary: 'Add another organisation domain (blocked while locked)' })
  addDomain(@Body() dto: AddIdentityDomainDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.domains.addDomain(dto.domain, dto.confirmDomain, this.actorOf(user, request));
  }

  @Delete('domains/:domain')
  @ApiOperation({ summary: 'Remove an additional organisation domain (blocked while locked)' })
  removeDomain(
    @Param('domain') domain: string,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.domains.removeDomain(domain, this.actorOf(user, request));
  }

  @Post('lock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock the domain so every future account must use it' })
  lock(@Body() dto: LockIdentityDomainDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.domains.lock(
      dto.confirmDomain,
      dto.acknowledgeMismatch ?? false,
      this.actorOf(user, request),
    );
  }

  @UseGuards(ReauthThrottleGuard)
  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock the domain — re-authenticated and audited' })
  unlock(@Body() dto: UnlockIdentityDomainDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.domains.unlock(dto.password, dto.reason, this.actorOf(user, request));
  }
}
