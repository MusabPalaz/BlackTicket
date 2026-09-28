import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { BRANDING } from '@black-ticket/shared';
import { AppModule } from './app.module';
import type { AppEnv } from './common/config/env.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<AppEnv, true>);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      // Unknown fields are rejected outright rather than silently dropped —
      // a request that does not match the contract is a bug or an attack.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Request bodies are small by design; the ingest endpoint caps at 512 KB.
  app.useBodyParser('json', { limit: '512kb' });

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(`${BRANDING.productName} API`)
      .setDescription(BRANDING.tagline)
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
      .build();

    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
      { swaggerOptions: { persistAuthorization: true } },
    );
  }

  app.enableShutdownHooks();

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`${BRANDING.productName} API listening on http://localhost:${port}`);
  if (!isProduction) {
    logger.log(`API documentation: http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
