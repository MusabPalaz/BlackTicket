import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../../common/decorators/auth.decorators';
import type { AppEnv } from '../../common/config/env.config';
import { AboutController } from './about.controller';

describe('AboutController', () => {
  const config = { get: () => 'v1.4.0' } as unknown as ConfigService<AppEnv, true>;

  it('reports the configured release', () => {
    expect(new AboutController(config).about()).toEqual({ version: 'v1.4.0' });
  });

  it('is not open to visitors who have not signed in', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AboutController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AboutController.prototype.about)).toBeUndefined();
  });
});
