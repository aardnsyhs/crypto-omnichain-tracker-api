import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/prisma.module';
import { SessionModule } from './sessions/session.module';
import { SessionMiddleware } from './sessions/session.middleware';
import { HistoryModule } from './history/history.module';

@Module({
  imports: [HealthModule, DatabaseModule, SessionModule, HistoryModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).exclude('health/{*path}').forRoutes('{*path}');
  }
}
