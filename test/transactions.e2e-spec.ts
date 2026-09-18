import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { CacheService } from '../src/cache/cache.service';
import { BlockchairClient } from '../src/providers/blockchair/blockchair.client';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import {
  ETHEREUM_SUCCESS_FIXTURE,
  ETHEREUM_SUCCESS_HASH,
} from '../src/providers/blockchair/fixtures/ethereum-success.fixture';
import {
  NOT_FOUND_EMPTY_DATA_FIXTURE,
  NOT_FOUND_HASH,
} from '../src/providers/blockchair/fixtures/not-found.fixture';

describe('Transactions Lookup Endpoints (e2e)', () => {
  let app: INestApplication;

  const mockPrisma = {
    $connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    $disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ '1': 1 }]),
    isHealthy: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    userSession: {
      create: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        id: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: 'session-id',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      }),
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      update: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
    },
    searchHistory: {
      create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
      findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    apiRequestLog: {
      create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
  };

  const mockBlockchairClient = {
    fetchTransaction: jest
      .fn<(chainSlug: string, hash: string) => Promise<unknown>>()
      .mockImplementation((chainSlug: string, hash: string) => {
        if (hash.toLowerCase() === NOT_FOUND_HASH.toLowerCase()) {
          return Promise.resolve({
            data: NOT_FOUND_EMPTY_DATA_FIXTURE,
            upstreamStatusCode: 200,
            providerDurationMs: 40,
          });
        }
        return Promise.resolve({
          data: ETHEREUM_SUCCESS_FIXTURE,
          upstreamStatusCode: 200,
          providerDurationMs: 75,
        });
      }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(BlockchairClient)
      .useValue(mockBlockchairClient)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser('dev-insecure-session-secret-change-in-prod'));
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

    await app.init();

    const cacheService = app.get(CacheService);
    await cacheService.del(`transaction:v1:ethereum:${ETHEREUM_SUCCESS_HASH.toLowerCase()}`);
  });

  afterAll(async () => {
    try {
      const cacheService = app.get(CacheService);
      await cacheService.del(`transaction:v1:ethereum:${ETHEREUM_SUCCESS_HASH.toLowerCase()}`);
    } catch {
      // Ignore cleanup error if app failed to init
    }
    await app.close();
  });

  describe('POST /v1/transactions/lookup', () => {
    it('returns normalized transaction on cache miss', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/transactions/lookup')
        .send({
          chain: 'ethereum',
          transactionHash: ETHEREUM_SUCCESS_HASH,
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body.data.chain).toBe('ethereum');
      expect(response.body.data.transactionHash).toBe(ETHEREUM_SUCCESS_HASH.toLowerCase());
      expect(response.body.data.status).toBe('confirmed');
      expect(response.body.data.value.symbol).toBe('ETH');
      expect(response.body.meta.cache.hit).toBe(false);
      expect(response.body.meta).toHaveProperty('requestId');
    });

    it('returns cached transaction on subsequent lookup (cache hit)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/transactions/lookup')
        .send({
          chain: 'ethereum',
          transactionHash: ETHEREUM_SUCCESS_HASH,
        })
        .expect(200);

      expect(response.body.data.chain).toBe('ethereum');
      expect(response.body.data.transactionHash).toBe(ETHEREUM_SUCCESS_HASH.toLowerCase());
      expect(response.body.meta.cache.hit).toBe(true);
    });

    it('returns HTTP 400 INVALID_TRANSACTION_HASH on malformed hash', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/transactions/lookup')
        .send({
          chain: 'ethereum',
          transactionHash: '0xinvalid_hash',
        })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_TRANSACTION_HASH');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('requestId');
    });

    it('returns HTTP 400 UNSUPPORTED_CHAIN on invalid chain', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/transactions/lookup')
        .send({
          chain: 'solana',
          transactionHash: ETHEREUM_SUCCESS_HASH,
        })
        .expect(400);

      expect(response.body.error.code).toBe('UNSUPPORTED_CHAIN');
      expect(response.body.error).toHaveProperty('requestId');
    });

    it('returns HTTP 400 VALIDATION_ERROR when required fields are missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/transactions/lookup')
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error).toHaveProperty('requestId');
    });

    it('returns HTTP 404 TRANSACTION_NOT_FOUND when upstream returns empty data', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/transactions/lookup')
        .send({
          chain: 'ethereum',
          transactionHash: NOT_FOUND_HASH,
        })
        .expect(404);

      expect(response.body.error.code).toBe('TRANSACTION_NOT_FOUND');
      expect(response.body.error).toHaveProperty('requestId');
    });

    it('enforces rate limit and returns HTTP 429 RATE_LIMIT_EXCEEDED when exceeded', async () => {
      // Default limit is 30 requests per minute
      let lastResponse;
      for (let i = 0; i < 35; i++) {
        lastResponse = await request(app.getHttpServer()).post('/v1/transactions/lookup').send({
          chain: 'ethereum',
          transactionHash: ETHEREUM_SUCCESS_HASH,
        });
        if (lastResponse.status === 429) {
          break;
        }
      }

      expect(lastResponse?.status).toBe(429);
      expect(lastResponse?.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(lastResponse?.body.error.message).toBe(
        'Client has exceeded public API lookup rate limits.',
      );
      expect(lastResponse?.body.error).toHaveProperty('requestId');
      expect(lastResponse?.headers).toHaveProperty('ratelimit-limit');
    });
  });
});
