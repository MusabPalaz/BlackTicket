import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/auth.decorators';
import { OidcService } from './oidc.service';
import { SsoExchangeDto } from './dto/sso.dto';
import { SsoService, type RequestContext } from './sso.service';

function contextOf(request: Request): RequestContext {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
}

@ApiTags('auth')
@Controller('auth/sso')
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly sso: SsoService,
    private readonly oidc: OidcService,
  ) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Whether the sign-in screen should offer federated sign-in' })
  status() {
    return this.sso.publicStatus();
  }

  /**
   * Entry point for the browser, not for fetch(): it answers with a redirect
   * to the identity provider, so the front end navigates here rather than
   * calling it.
   */
  @Public()
  @Get('start')
  @ApiOperation({ summary: 'Begin federated sign-in (redirects to the identity provider)' })
  async start(
    @Query('returnTo') returnTo: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      response.redirect(await this.sso.start(returnTo, contextOf(request)));
    } catch (error) {
      response.redirect(this.failureUrl(error));
    }
  }

  @Public()
  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      response.redirect(await this.sso.callback(request.originalUrl, contextOf(request)));
    } catch (error) {
      /*
       * The caller is a browser tab mid-redirect, so a failure has to land
       * somewhere a person can read. The detail goes to the log; the tab gets
       * a short reason.
       */
      this.logger.warn(
        `Federated sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      response.redirect(this.failureUrl(error));
    }
  }

  @Public()
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trade the one-time handoff code for a token pair' })
  exchange(@Body() dto: SsoExchangeDto, @Req() request: Request) {
    return this.sso.exchange(dto.code, contextOf(request));
  }

  private failureUrl(error: unknown): string {
    const target = new URL('/login', this.oidc.webBaseUrl());
    const message =
      error instanceof Error && error.message ? error.message : 'Federated sign-in failed.';
    target.searchParams.set('ssoError', message.slice(0, 300));
    return target.href;
  }
}
