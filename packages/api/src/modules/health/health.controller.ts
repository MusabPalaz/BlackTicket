import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BRANDING } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/auth.decorators';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe — the process is up' })
  live() {
    return {
      status: 'ok',
      service: BRANDING.productName,
      version: process.env.npm_package_version ?? '0.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — dependencies are reachable' })
  async ready() {
    const startedAt = Date.now();
    let database: { status: string; latencyMs?: number; error?: string };

    try {
      await this.prisma.ping();
      database = { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      database = {
        status: 'error',
        error: error instanceof Error ? error.message : 'unknown error',
      };
    }

    return {
      status: database.status === 'ok' ? 'ok' : 'degraded',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
  }
}
