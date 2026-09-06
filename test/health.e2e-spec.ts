import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health Endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1', {
      exclude: ['health/(.*)'],
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('returns 200 OK with liveness payload', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(typeof response.body.uptimeSeconds).toBe('number');
      expect(typeof response.body.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 OK with honest degraded readiness payload', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

      expect(response.body).toEqual({
        status: 'degraded',
        checks: {
          api: 'ready',
          database: 'not_checked',
          redis: 'not_checked',
        },
        phase: 'milestone-1a',
      });
    });
  });
});
