import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AuthService } from './auth/auth.service';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import * as fs from 'fs';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { RuntimeMetricsService } from './health/runtime-metrics.service';

async function bootstrap() {
  // Configure Winston Logger
  const logger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.ms(),
          process.env.NODE_ENV === 'production'
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
              ),
        ),
      }),
    ],
  });

  const app = await NestFactory.create(AppModule, { logger, bodyParser: false });

  const metrics = app.get(RuntimeMetricsService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      const search = route === '/v1/bookmarks' && req.method === 'GET' && req.query.search ? ' [search]' : '';
      metrics.request(`${req.method} ${route}${search}`, Number(process.hrtime.bigint() - start) / 1e6, res.statusCode >= 500);
    });
    next();
  });

  // CORS
  app.enableCors({
    origin: (origin, callback) => {
      const frontendOrigin = new URL(process.env.FRONTEND_URL || 'http://localhost:3000').origin;
      const allowed = new Set([frontendOrigin, 'http://localhost:3000', 'http://127.0.0.1:3000']);
      callback(null, !origin || allowed.has(origin));
    },
    credentials: true,
  });

  // Better Auth reads the raw body before the other API routes parse it.
  app.getHttpAdapter().getInstance().all('/v1/auth/{*path}', toNodeHandler(app.get(AuthService).auth));
  // Drawings carry their embedded images, so their autosave route takes larger bodies.
  app.use(/^\/v1\/bookmarks\/[^/]+\/drawing$/, json({ limit: '15mb' }));
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true }));

  // Global validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global Interceptors and Filters
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Cabinet API')
    .setDescription('API for Cabinet bookmarks, notes, and saved reading')
    .setVersion('1.0')
    .addCookieAuth('cabinet.session_token')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Write OpenAPI JSON spec on startup
  try {
    const swaggerJsonPath = path.resolve(process.cwd(), 'openapi.json');
    fs.writeFileSync(swaggerJsonPath, JSON.stringify(document, null, 2));
    logger.log(`OpenAPI JSON spec written to: ${swaggerJsonPath}`);
  } catch (err) {
    logger.error('Failed to write OpenAPI JSON spec file', err);
  }

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
