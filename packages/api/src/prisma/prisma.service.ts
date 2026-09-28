import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { AppEnv } from '../common/config/env.config';

/**
 * Prisma 7 talks to PostgreSQL through a driver adapter, so the connection pool
 * is ours to size.
 *
 * The size is configuration rather than a constant because it is the one knob
 * that has to move with the deployment: a load test at the target scale spent
 * most of its time with requests queued behind a pool of twenty, not with
 * PostgreSQL working. Raise it only together with PostgreSQL's max_connections.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<AppEnv, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        max: config.get('DATABASE_POOL_MAX', { infer: true }),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight readiness probe used by the health endpoint. */
  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
