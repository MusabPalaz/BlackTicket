import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { AuthPolicyService } from './auth-policy.service';
import { UpdateAuthPolicyDto } from './dto/auth-policy.dto';

@ApiTags('admin')
@Controller('admin/settings/auth-policy')
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class AuthPolicyController {
  constructor(private readonly policy: AuthPolicyService) {}

  @Get()
  @ApiOperation({ summary: 'Federated sign-in policy; the client secret is never returned' })
  get() {
    return this.policy.view();
  }

  @Put()
  @ApiOperation({ summary: 'Update the policy. Omit clientSecret to keep the stored one.' })
  update(@Body() dto: UpdateAuthPolicyDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.policy.update(dto, {
      id: user.id,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check that the configured provider answers discovery' })
  test() {
    return this.policy.test();
  }
}
