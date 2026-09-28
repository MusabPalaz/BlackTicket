import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { validateEnv, type AppEnv } from './common/config/env.config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { ScimModule } from './modules/scim/scim.module';
import { MailModule } from './modules/mail/mail.module';
import { CasesModule } from './modules/cases/cases.module';
import { ObservablesModule } from './modules/observables/observables.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
          transport:
            config.get('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          // Credentials and tokens must never reach the log files.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.totpCode',
              'req.body.refreshToken',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => [
        {
          name: 'global',
          ttl: 60_000,
          limit: config.get('RATE_LIMIT_GLOBAL_PER_MIN', { infer: true }),
        },
      ],
    }),

    // Drives the SLA sweep; without it the clocks would only ever be checked
    // when a human happened to open a page.
    ScheduleModule.forRoot(),

    PrismaModule,
    AuditModule,
    SettingsModule,
    UsersModule,
    AuthModule,
    AdminModule,
    ScimModule,
    MailModule,
    CasesModule,
    ObservablesModule,
    NotificationsModule,
    AlertsModule,
    MetricsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order matters: rate limit, then identity, then the forced password
    // rotation, and only then role permissions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
