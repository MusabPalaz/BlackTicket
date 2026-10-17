import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { OidcService } from './oidc.service';
import { SsoController } from './sso.controller';
import type { SsoService } from './sso.service';

function harness(webBaseUrl: string) {
  const sso = {
    start: vi.fn(async () => ({
      url: 'https://idp.corp.example/authorize?state=s',
      binding: 'b1nd',
    })),
    callback: vi.fn(async () => `${webBaseUrl}/auth/sso/callback?code=handoff`),
  };
  const oidc = { webBaseUrl: () => webBaseUrl };
  const controller = new SsoController(
    sso as unknown as SsoService,
    oidc as unknown as OidcService,
  );
  const response = { cookie: vi.fn(), redirect: vi.fn(), clearCookie: vi.fn() };
  const request = (cookie?: string) =>
    ({
      ip: '203.0.113.7',
      originalUrl: '/api/v1/auth/sso/callback?code=c&state=s',
      headers: cookie ? { cookie } : {},
      get: () => 'vitest',
    }) as unknown as Request;

  return { controller, sso, response, request };
}

describe('the sign-in binding cookie', () => {
  it('is HttpOnly, host-only and Lax over https', async () => {
    const { controller, response, request } = harness('https://soc.corp.example');

    await controller.start(undefined, request(), response as unknown as Response);

    expect(response.cookie).toHaveBeenCalledWith('__Host-bt_sso', 'b1nd', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    expect(response.redirect).toHaveBeenCalledWith('https://idp.corp.example/authorize?state=s');
  });

  it('drops the prefix and Secure on a plain-http development setup', async () => {
    const { controller, response, request } = harness('http://localhost:5173');

    await controller.start(undefined, request(), response as unknown as Response);

    expect(response.cookie).toHaveBeenCalledWith(
      'bt_sso',
      'b1nd',
      expect.objectContaining({ secure: false }),
    );
  });

  it('is read back on the callback from among other cookies', async () => {
    const { controller, sso, response, request } = harness('https://soc.corp.example');

    await controller.callback(
      request('theme=navy; __Host-bt_sso=b1nd; other=1'),
      response as unknown as Response,
    );

    expect(sso.callback).toHaveBeenCalledWith(
      '/api/v1/auth/sso/callback?code=c&state=s',
      'b1nd',
      expect.anything(),
    );
  });
});
