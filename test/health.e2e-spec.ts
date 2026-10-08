import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { CacheService } from '../src/cache/cache.service';

describe('Health HTTP contract', () => {
  let app: INestApplication;
  let databaseReady = true;
  let redisReady = true;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: async () => databaseReady })
      .overrideProvider(CacheService)
      .useValue({ ping: async () => redisReady })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health/{*path}'] });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('does not create sessions or consume lookup quotas', async () => {
    for (let i = 0; i < 35; i++) {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });
  it('returns 503 when PostgreSQL is unavailable', async () => {
    databaseReady = false;
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.status).toBe('unavailable');
    databaseReady = true;
  });
  it('returns an explicit degraded state when Redis is unavailable', async () => {
    redisReady = false;
    expect((await request(app.getHttpServer()).get('/health/ready').expect(200)).body.status).toBe(
      'degraded',
    );
    redisReady = true;
  });
  it('returns ready when both dependencies work', async () => {
    expect((await request(app.getHttpServer()).get('/health/ready').expect(200)).body.status).toBe(
      'ready',
    );
  });
});
