import { EventEmitter } from 'node:events';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../config/env.config';
import { LOGIN_CREDENTIAL_FAILURE, LoginThrottleGuard } from './login-throttle.guard';

const LIMITS = { RATE_LIMIT_LOGIN_PER_MIN: 3, RATE_LIMIT_LOGIN_FAILURES_PER_IP_PER_MIN: 5 };

function guard(): LoginThrottleGuard {
  const config = { get: (key: keyof typeof LIMITS) => LIMITS[key] };
  return new LoginThrottleGuard(config as unknown as ConfigService<AppEnv, true>);
}

/** One sign-in request; `failed` decides how the handler would have answered it. */
function attempt(subject: LoginThrottleGuard, username: string, failed: boolean, ip = '198.51.100.4') {
  const response = Object.assign(new EventEmitter(), { locals: {} as Record<string, unknown> });
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ ip, body: { username } }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  try {
    subject.canActivate(context);
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() === 429) return 429;
    throw error;
  }
  if (failed) response.locals[LOGIN_CREDENTIAL_FAILURE] = true;
  response.emit('finish');
  return failed ? 401 : 200;
}

describe('LoginThrottleGuard', () => {
  it('counts padded and re-cased spellings of a username as the same account', () => {
    const subject = guard();
    const answers = ['admin', ' admin', 'ADMIN ', '  Admin'].map((name) =>
      attempt(subject, name, false),
    );
    expect(answers).toEqual([200, 200, 200, 429]);
  });

  it('stops one address spraying a password across many usernames', () => {
    const subject = guard();
    const answers = Array.from({ length: 7 }, (_, index) => attempt(subject, `user${index}`, true));
    expect(answers).toEqual([401, 401, 401, 401, 401, 429, 429]);
  });

  it('does not hold successful sign-ins from one address against it', () => {
    const subject = guard();
    const answers = Array.from({ length: 20 }, (_, index) => attempt(subject, `user${index}`, false));
    expect(answers.every((status) => status === 200)).toBe(true);
  });

  it('keeps the failure budget per address', () => {
    const subject = guard();
    for (let index = 0; index < 5; index += 1) attempt(subject, `user${index}`, true);
    expect(attempt(subject, 'other', false, '198.51.100.99')).toBe(200);
  });
});
