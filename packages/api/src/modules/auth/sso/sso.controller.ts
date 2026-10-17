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
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../../../common/decorators/auth.decorators';
import { OidcService } from './oidc.service';
import { SsoExchangeDto } from './dto/sso.dto';
import { ATTEMPT_TTL_MS, SsoService, type RequestContext } from './sso.service';

function contextOf(request: Request): RequestContext {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
}

/** One cookie's value from the raw header; nothing else here reads cookies. */
function readCookie(request: Request, name: string): string | null {
  for (const pair of (request.headers.cookie ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator !== -1 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim() || null;
    }
  }
  return null;
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
      const { url, binding } = await this.sso.start(returnTo, contextOf(request));
      const cookie = this.bindingCookie();
      response.cookie(cookie.name, binding, { ...cookie.options, maxAge: ATTEMPT_TTL_MS });
      response.redirect(url);
    } catch (error) {
      response.redirect(this.failureUrl(error));
    }
  }

  @Public()
  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      const binding = readCookie(request, this.bindingCookie().name);
      response.redirect(await this.sso.callback(request.originalUrl, binding, contextOf(request)));
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
  async exchange(
    @Body() dto: SsoExchangeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookie = this.bindingCookie();
    const result = await this.sso.exchange(
      dto.code,
      readCookie(request, cookie.name),
      contextOf(request),
    );
    // The attempt is spent; the cookie would only linger until it expired.
    response.clearCookie(cookie.name, cookie.options);
    return result;
  }

  /**
   * The cookie tying a sign-in to the browser that started it.
   *
   * `__Host-` stops a sibling subdomain from planting a value of its own, which
   * is exactly what forcing someone into another person's sign-in would take.
   * The prefix demands Secure, so a plain-http development setup gets an
   * unprefixed name instead. Lax, because the provider sends the browser back
   * with a top-level GET, which Lax lets through.
   */
  private bindingCookie(): { name: string; options: CookieOptions } {
    const secure = new URL(this.oidc.webBaseUrl()).protocol === 'https:';
    return {
      name: secure ? '__Host-bt_sso' : 'bt_sso',
      options: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
    };
  }

  private failureUrl(error: unknown): string {
    const target = new URL('/login', this.oidc.webBaseUrl());
    const message =
      error instanceof Error && error.message ? error.message : 'Federated sign-in failed.';
    target.searchParams.set('ssoError', message.slice(0, 300));
    return target.href;
  }
}
