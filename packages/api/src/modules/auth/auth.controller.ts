import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import {
  AllowPendingPasswordChange,
  CurrentUser,
  Public,
} from '../../common/decorators/auth.decorators';
import { LoginThrottleGuard } from '../../common/guards/login-throttle.guard';
import { ReauthThrottleGuard } from '../../common/guards/reauth-throttle.guard';
import { UsersService } from '../users/users.service';
import { AuthService, type RequestContext } from './auth.service';
import {
  ChangePasswordDto,
  DisableTotpDto,
  EnableTotpDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
} from './dto/auth.dto';

function contextOf(request: Request): RequestContext {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with username, password and optional TOTP code' })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto.username, dto.password, dto.totpCode, contextOf(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(dto.refreshToken, contextOf(request));
  }

  @AllowPendingPasswordChange()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@Body() dto: LogoutDto, @CurrentUser() user: User, @Req() request: Request) {
    await this.auth.logout(user.id, dto.refreshToken, contextOf(request));
  }

  @AllowPendingPasswordChange()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in account and its effective permissions' })
  me(@CurrentUser() user: User) {
    return UsersService.toPublicUser(user);
  }

  @AllowPendingPasswordChange()
  @UseGuards(ReauthThrottleGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change own password; revokes all other sessions' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    await this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      contextOf(request),
    );
  }

  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a TOTP secret; not active until confirmed' })
  startTotp(@CurrentUser() user: User) {
    return this.auth.startTotpSetup(user.id);
  }

  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the TOTP secret and receive recovery codes' })
  enableTotp(@Body() dto: EnableTotpDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.auth.enableTotp(user.id, dto.code, contextOf(request));
  }

  @UseGuards(ReauthThrottleGuard)
  @Post('totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disable TOTP (requires the account password)' })
  async disableTotp(
    @Body() dto: DisableTotpDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    await this.auth.disableTotp(user.id, dto.password, contextOf(request));
  }
}
