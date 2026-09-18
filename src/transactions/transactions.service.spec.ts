import { jest } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import type { PrismaService } from '../database/prisma.service';
import type { CacheService } from '../cache/cache.service';
import type { BlockchairService } from '../providers/blockchair/blockchair.service';
import type { HistoryService } from '../history/history.service';
import type { NormalizedTransaction } from '../providers/blockchair/blockchair.interface';
import { ApiException } from '../common/exceptions/api.exception';
import type { UserSession } from '@prisma/client';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let mockPrisma: { apiRequestLog: { create: jest.Mock } };
  let mockCache: { get: jest.Mock; set: jest.Mock };
  let mockBlockchair: { getTransaction: jest.Mock };
  let mockHistory: { recordSearch: jest.Mock };

  const mockNormalizedTx: NormalizedTransaction = {
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    chain: 'ethereum',
    status: 'confirmed',
    blockNumber: '123456',
    timestamp: '2026-09-01T12:00:00Z',
    from: '0x1234567890abcdef1234567890abcdef12345678',
    to: '0xabcdef1234567890abcdef1234567890abcdef12',
    value: {
      raw: '1500000000000000000',
      formatted: '1.5',
      symbol: 'ETH',
    },
    fee: {
      raw: '2100000000000000',
      formatted: '0.0021',
      symbol: 'ETH',
    },
    explorerUrl: 'https://etherscan.io/tx/0x123',
  };

  const mockSession: UserSession = {
    id: 'db-session-uuid',
    sessionId: 'session-cookie-token',
    createdAt: new Date(),
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
  };

  beforeEach(() => {
    mockPrisma = {
      apiRequestLog: {
        create: jest.fn().mockResolvedValue({} as never),
      },
    };
    mockCache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(true as never),
    };
    mockBlockchair = {
      getTransaction: jest.fn(),
    };
    mockHistory = {
      recordSearch: jest.fn().mockResolvedValue({} as never),
    };

    service = new TransactionsService(
      mockPrisma as unknown as PrismaService,
      mockCache as unknown as CacheService,
      mockBlockchair as unknown as BlockchairService,
      mockHistory as unknown as HistoryService,
    );
  });

  it('returns cached data on cache hit without invoking provider', async () => {
    mockCache.get.mockResolvedValue(mockNormalizedTx as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockNormalizedTx.transactionHash,
      },
      mockSession,
      'test-request-id',
    );

    expect(result.data).toEqual(mockNormalizedTx);
    expect(result.meta.cache.hit).toBe(true);
    expect(result.meta.requestId).toBe('test-request-id');
    expect(mockCache.get).toHaveBeenCalledWith(
      `transaction:v1:ethereum:${mockNormalizedTx.transactionHash}`,
    );
    expect(mockBlockchair.getTransaction).not.toHaveBeenCalled();
  });

  it('fetches from provider, updates cache, and records history on cache miss', async () => {
    mockCache.get.mockResolvedValue(null as never);
    mockBlockchair.getTransaction.mockResolvedValue({
      transaction: mockNormalizedTx,
      upstreamStatusCode: 200,
      providerDurationMs: 145,
    } as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockNormalizedTx.transactionHash,
      },
      mockSession,
      'test-request-id',
    );

    expect(result.data).toEqual(mockNormalizedTx);
    expect(result.meta.cache.hit).toBe(false);
    expect(mockBlockchair.getTransaction).toHaveBeenCalledWith(
      'ethereum',
      mockNormalizedTx.transactionHash,
    );
    expect(mockCache.set).toHaveBeenCalledWith(
      `transaction:v1:ethereum:${mockNormalizedTx.transactionHash}`,
      mockNormalizedTx,
    );
    expect(mockHistory.recordSearch).toHaveBeenCalledWith('db-session-uuid', {
      transactionHash: mockNormalizedTx.transactionHash,
      chain: 'ethereum',
      outcome: 'success',
      cacheHit: false,
    });
  });

  it('handles provider error and propagates ApiException while recording request log', async () => {
    mockCache.get.mockResolvedValue(null as never);
    mockBlockchair.getTransaction.mockRejectedValue(
      new ApiException(
        'TRANSACTION_NOT_FOUND',
        'Transaction not found on upstream',
        HttpStatus.NOT_FOUND,
      ) as never,
    );

    await expect(
      service.lookupTransaction({
        chain: 'ethereum',
        transactionHash: mockNormalizedTx.transactionHash,
      }),
    ).rejects.toThrow(ApiException);

    expect(mockPrisma.apiRequestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: 'not_found',
          cacheOutcome: 'miss',
        }),
      }),
    );
  });

  it('safely tolerates database logging failures without throwing', async () => {
    mockCache.get.mockResolvedValue(mockNormalizedTx as never);
    mockPrisma.apiRequestLog.create.mockRejectedValue(new Error('DB connection lost') as never);
    mockHistory.recordSearch.mockRejectedValue(new Error('DB connection lost') as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockNormalizedTx.transactionHash,
      },
      mockSession,
    );

    expect(result.data).toEqual(mockNormalizedTx);
  });
});
