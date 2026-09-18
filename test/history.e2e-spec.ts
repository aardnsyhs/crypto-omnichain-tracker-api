import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { UserSession, SearchHistory } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('History and Session Endpoints (e2e)', () => {
  let app: INestApplication;

  const mockSessions = new Map<string, UserSession>();
  const mockHistories: SearchHistory[] = [];

  const mockPrisma = {
    $connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    $disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ '1': 1 }]),
    isHealthy: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    userSession: {
      create: jest
        .fn<(args: { data: { sessionId: string; expiresAt: Date } }) => Promise<UserSession>>()
        .mockImplementation(({ data }) => {
          const record: UserSession = {
            id: '123e4567-e89b-12d3-a456-426614174000',
            sessionId: data.sessionId,
            createdAt: new Date(),
            lastActiveAt: new Date(),
            expiresAt: data.expiresAt,
          };
          mockSessions.set(data.sessionId, record);
          return Promise.resolve(record);
        }),
      findUnique: jest
        .fn<(args: { where: { sessionId: string } }) => Promise<UserSession | null>>()
        .mockImplementation(({ where }) => {
          const record = mockSessions.get(where.sessionId);
          return Promise.resolve(record || null);
        }),
      update: jest
        .fn<
          (args: {
            where: { sessionId: string };
            data: { lastActiveAt: Date; expiresAt: Date };
          }) => Promise<UserSession | null>
        >()
        .mockImplementation(({ where, data }) => {
          const record = mockSessions.get(where.sessionId);
          if (record) {
            record.lastActiveAt = data.lastActiveAt;
            record.expiresAt = data.expiresAt;
          }
          return Promise.resolve(record || null);
        }),
    },
    searchHistory: {
      create: jest
        .fn<
          (args: {
            data: {
              userSessionId: string;
              transactionHash: string;
              chain: string;
              outcome: string;
              cacheHit: boolean;
            };
          }) => Promise<SearchHistory>
        >()
        .mockImplementation(({ data }) => {
          const record: SearchHistory = {
            id: '123e4567-e89b-12d3-a456-426614174001',
            userSessionId: data.userSessionId,
            transactionHash: data.transactionHash,
            chain: data.chain,
            outcome: data.outcome,
            cacheHit: data.cacheHit,
            searchedAt: new Date(),
          };
          mockHistories.push(record);
          return Promise.resolve(record);
        }),
      findMany: jest
        .fn<(args: { where: { userSessionId: string } }) => Promise<SearchHistory[]>>()
        .mockImplementation(({ where }) => {
          return Promise.resolve(
            mockHistories.filter((h) => h.userSessionId === where.userSessionId),
          );
        }),
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser('dev-insecure-session-secret-change-in-prod'));
    app.setGlobalPrefix('v1', {
      exclude: ['health/{*path}'],
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/history', () => {
    it('issues an HTTP-only signed session cookie on first request and returns empty history', async () => {
      const response = await request(app.getHttpServer()).get('/v1/history').expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta).toHaveProperty('sessionId');
      expect(response.body.meta.sessionId.length).toBe(64);

      // Verify Set-Cookie header
      const rawCookies: unknown = response.headers['set-cookie'];
      const cookies: string[] = Array.isArray(rawCookies)
        ? (rawCookies as string[])
        : typeof rawCookies === 'string'
          ? [rawCookies]
          : [];
      expect(cookies.length).toBeGreaterThan(0);
      const sessionCookie = cookies.find((c: string) => c.startsWith('omnichain_session='));
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=Lax');
    });

    it('reuses the existing session when the cookie is sent back', async () => {
      // 1. First request to obtain cookie
      const firstResponse = await request(app.getHttpServer()).get('/v1/history').expect(200);

      const firstSessionId = firstResponse.body.meta.sessionId;
      const rawCookies: unknown = firstResponse.headers['set-cookie'];
      const cookies: string[] = Array.isArray(rawCookies)
        ? (rawCookies as string[])
        : typeof rawCookies === 'string'
          ? [rawCookies]
          : [];

      // 2. Second request with cookie
      const secondResponse = await request(app.getHttpServer())
        .get('/v1/history')
        .set('Cookie', cookies)
        .expect(200);

      expect(secondResponse.body.meta.sessionId).toBe(firstSessionId);
      // It should not issue a new cookie because session is already active
      expect(secondResponse.headers['set-cookie']).toBeUndefined();
    });
  });
});
