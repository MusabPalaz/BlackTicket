import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BRANDING } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/auth.decorators';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

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
      // The probe is public, and a driver's error names hosts, ports and
      // users. The detail goes to the log; the answer only says it failed.
      this.logger.error(
        `Readiness check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      database = { status: 'error', error: 'database unreachable' };
    }

    return {
      status: database.status === 'ok' ? 'ok' : 'degraded',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
  }
}
