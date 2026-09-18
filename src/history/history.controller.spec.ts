import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import type { UserSession } from '@prisma/client';

describe('HistoryController', () => {
  let controller: HistoryController;
  let historyService: {
    getSessionHistory: jest.Mock<(sessionId: string, limit?: number) => Promise<unknown>>;
  };

  const mockSession: UserSession = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    sessionId: 'a'.repeat(64),
    createdAt: new Date(),
    lastActiveAt: new Date(),
    expiresAt: new Date(),
  };

  const mockRecord = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    userSessionId: mockSession.id,
    transactionHash: '0x' + '1'.repeat(64),
    chain: 'ethereum',
    outcome: 'success',
    cacheHit: true,
    searchedAt: new Date('2026-09-18T10:00:00.000Z'),
  };

  beforeEach(async () => {
    historyService = {
      getSessionHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HistoryController],
      providers: [
        {
          provide: HistoryService,
          useValue: historyService,
        },
      ],
    }).compile();

    controller = module.get<HistoryController>(HistoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHistory', () => {
    it('should return empty list if session is undefined', async () => {
      const response = await controller.getHistory(undefined);
      expect(response).toEqual({
        data: [],
        meta: {
          total: 0,
          sessionId: '',
        },
      });
    });

    it('should return mapped history records for active session', async () => {
      historyService.getSessionHistory.mockResolvedValue([mockRecord]);

      const response = await controller.getHistory(mockSession, '10');
      expect(response.data).toHaveLength(1);
      expect(response.data[0].transactionHash).toBe(mockRecord.transactionHash);
      expect(response.data[0].searchedAt).toBe('2026-09-18T10:00:00.000Z');
      expect(response.meta.sessionId).toBe(mockSession.sessionId);
      expect(response.meta.total).toBe(1);
      expect(historyService.getSessionHistory).toHaveBeenCalledWith(mockSession.id, 10);
    });
  });
});
