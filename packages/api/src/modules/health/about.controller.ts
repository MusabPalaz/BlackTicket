import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppEnv } from '../../common/config/env.config';

/**
 * Which release is running, for the sidebar.
 *
 * Behind sign-in on purpose, unlike the health probes: the exact release is
 * the first thing anyone matching a server against published advisories looks
 * for, and nobody who has not signed in needs it.
 */
@ApiTags('health')
@Controller('about')
export class AboutController {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  @Get()
  @ApiOperation({ summary: 'The release this server is running' })
  about(): { version: string } {
    return { version: this.config.get('APP_VERSION', { infer: true }) };
  }
}
