import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/prisma.module';
import { SessionModule } from './sessions/session.module';
import { SessionMiddleware } from './sessions/session.middleware';
import { HistoryModule } from './history/history.module';
import { CacheModule } from './cache/cache.module';
import { TransactionsModule } from './transactions/transactions.module';
import { OverviewModule } from './overview/overview.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl:
          (process.env.THROTTLE_TTL_SECONDS
            ? Number.parseInt(process.env.THROTTLE_TTL_SECONDS, 10)
            : 60) * 1000,
        limit: process.env.THROTTLE_LIMIT ? Number.parseInt(process.env.THROTTLE_LIMIT, 10) : 30,
      },
    ]),
    HealthModule,
    DatabaseModule,
    CacheModule,
    SessionModule,
    HistoryModule,
    TransactionsModule,
    OverviewModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).exclude('health/{*path}').forRoutes('{*path}');
  }
}
