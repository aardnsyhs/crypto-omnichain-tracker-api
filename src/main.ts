import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const sessionSecret = process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-in-prod';
  app.use(cookieParser(sessionSecret));

  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: [webOrigin],
    credentials: true,
  });

  app.setGlobalPrefix('v1', {
    exclude: ['health/{*path}'],
  });

  const port = process.env.PORT || process.env.API_PORT || 4000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

void bootstrap();
