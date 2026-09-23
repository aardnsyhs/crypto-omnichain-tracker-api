import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { HistoryService } from './history.service';
import { PrismaService } from '../database/prisma.service';

describe('HistoryService', () => {
  let service: HistoryService;
  let prisma: {
    searchHistory: {
      create: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
      findMany: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    };
  };

  const mockHistoryRecord = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    userSessionId: '123e4567-e89b-12d3-a456-426614174000',
    transactionHash: '0x' + '1'.repeat(64),
    chain: 'ethereum',
    outcome: 'success',
    txStatus: 'confirmed',
    cacheHit: true,
    searchedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      searchHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoryService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<HistoryService>(HistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordSearch', () => {
    it('should normalize and insert a search record scoped to userSessionId with txStatus', async () => {
      prisma.searchHistory.create.mockResolvedValue(mockHistoryRecord);

      const result = await service.recordSearch(mockHistoryRecord.userSessionId, {
        transactionHash: '0X' + '1'.repeat(64),
        chain: 'ETHEREUM',
        outcome: 'success',
        txStatus: 'confirmed',
        cacheHit: true,
      });

      expect(result).toBe(mockHistoryRecord);
      expect(prisma.searchHistory.create).toHaveBeenCalledWith({
        data: {
          userSessionId: mockHistoryRecord.userSessionId,
          transactionHash: ('0x' + '1'.repeat(64)).toLowerCase(),
          chain: 'ethereum',
          outcome: 'success',
          txStatus: 'confirmed',
          cacheHit: true,
        },
      });
    });
  });

  describe('getSessionHistory', () => {
    it('should query history scoped to userSessionId ordered descending', async () => {
      prisma.searchHistory.findMany.mockResolvedValue([mockHistoryRecord]);

      const result = await service.getSessionHistory(mockHistoryRecord.userSessionId, 10);
      expect(result).toEqual([mockHistoryRecord]);
      expect(prisma.searchHistory.findMany).toHaveBeenCalledWith({
        where: { userSessionId: mockHistoryRecord.userSessionId },
        orderBy: { searchedAt: 'desc' },
        take: 10,
      });
    });
  });
});
