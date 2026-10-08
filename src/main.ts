import 'dotenv/config';
import { validateEnvironment } from './config/environment';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  validateEnvironment();
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set(
    'trust proxy',
    process.env.TRUST_LOCAL_PROXY === 'true' ? ['127.0.0.1/32', '::1/128'] : false,
  );
  app.enableShutdownHooks();

  const sessionSecret = process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-in-prod';
  app.use(cookieParser(sessionSecret));

  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: [webOrigin],
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.setGlobalPrefix('v1', {
    exclude: ['health/{*path}'],
  });

  const port = process.env.PORT || process.env.API_PORT || 4000;
  await app.listen(port, process.env.API_HOST || '127.0.0.1');
}

void bootstrap().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
