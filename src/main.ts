import * as path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const sessionSecret = process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-in-prod';
  app.use(cookieParser(sessionSecret));

  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: [webOrigin],
    credentials: true,
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
  await app.listen(port);
}

void bootstrap();
