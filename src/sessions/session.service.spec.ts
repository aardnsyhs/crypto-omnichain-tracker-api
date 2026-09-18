import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { PrismaService } from '../database/prisma.service';

describe('SessionService', () => {
  let service: SessionService;
  let prisma: {
    userSession: {
      create: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
      findUnique: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
      update: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    };
  };

  const mockSession = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    sessionId: 'a'.repeat(64),
    createdAt: new Date(),
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  beforeEach(async () => {
    prisma = {
      userSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateSessionId', () => {
    it('should generate a 64-character hex string', () => {
      const id = service.generateSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(id)).toBe(true);
    });
  });

  describe('createSession', () => {
    it('should insert and return a new UserSession record', async () => {
      prisma.userSession.create.mockResolvedValue(mockSession);

      const result = await service.createSession();
      expect(result).toBe(mockSession);
      expect(prisma.userSession.create).toHaveBeenCalledTimes(1);
      const callArg = prisma.userSession.create.mock.calls[0][0] as {
        data: { sessionId: string; expiresAt: Date };
      };
      expect(callArg.data.sessionId).toBeDefined();
      expect(callArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('validateSession', () => {
    it('should return session if found and unexpired', async () => {
      prisma.userSession.findUnique.mockResolvedValue(mockSession);

      const result = await service.validateSession(mockSession.sessionId);
      expect(result).toBe(mockSession);
      expect(prisma.userSession.findUnique).toHaveBeenCalledWith({
        where: { sessionId: mockSession.sessionId },
      });
    });

    it('should return null if session is not in database', async () => {
      prisma.userSession.findUnique.mockResolvedValue(null);

      const result = await service.validateSession('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null if session has expired', async () => {
      const expiredSession = {
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000),
      };
      prisma.userSession.findUnique.mockResolvedValue(expiredSession);

      const result = await service.validateSession(expiredSession.sessionId);
      expect(result).toBeNull();
    });
  });

  describe('getOrCreateSession', () => {
    it('should issue a new session when candidate is undefined', async () => {
      prisma.userSession.create.mockResolvedValue(mockSession);

      const result = await service.getOrCreateSession(undefined);
      expect(result.isNew).toBe(true);
      expect(result.session).toBe(mockSession);
    });

    it('should return existing session when candidate is valid', async () => {
      prisma.userSession.findUnique.mockResolvedValue(mockSession);
      prisma.userSession.update.mockResolvedValue(mockSession);

      const result = await service.getOrCreateSession(mockSession.sessionId);
      expect(result.isNew).toBe(false);
      expect(result.session).toBe(mockSession);
    });
  });
});
