import { jest } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import type { PrismaService } from '../database/prisma.service';
import type { CacheService } from '../cache/cache.service';
import type { BlockchairService } from '../providers/blockchair/blockchair.service';
import type { EvmRpcService } from '../providers/rpc/evm-rpc.service';
import type { StoryGeneratorService } from './story/story-generator.service';
import type { HistoryService } from '../history/history.service';
import type { NormalizedTransaction } from '../providers/blockchair/blockchair.interface';
import type { RpcEnrichmentData } from '../providers/rpc/evm-rpc.interface';
import type { EnrichedTransactionData } from './dto/transaction-response.dto';
import { ApiException } from '../common/exceptions/api.exception';
import type { UserSession } from '@prisma/client';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let mockPrisma: { apiRequestLog: { create: jest.Mock } };
  let mockCache: { get: jest.Mock; set: jest.Mock };
  let mockBlockchair: { getTransaction: jest.Mock };
  let mockRpc: { enrichTransaction: jest.Mock; createBaseTransaction: jest.Mock };
  let mockStoryGenerator: { generateStory: jest.Mock };
  let mockHistory: { recordSearch: jest.Mock };

  const mockBaseTx: NormalizedTransaction = {
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

  const mockEnrichment: RpcEnrichmentData = {
    receipt: {
      transactionHash: mockBaseTx.transactionHash,
      transactionIndex: '0x1',
      blockHash: '0xblock',
      blockNumber: '0x1e240',
      from: mockBaseTx.from,
      to: mockBaseTx.to,
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      contractAddress: null,
      logs: [],
      status: '0x1',
    },
    transaction: null,
    inputData: null,
    gasUsed: '21000',
    status: 'confirmed',
    logs: [],
    tokenMetadataMap: new Map(),
    temporaryFailure: false,
  };

  const mockEnrichedData: EnrichedTransactionData = {
    ...mockBaseTx,
    family: 'evm',
    fetchedAt: '2026-09-01T12:00:05.000Z',
    explanation: 'Transferred 1.5 ETH from 0x123... to 0xabc....',
    coverage: 'complete',
    coverageReasons: [],
    actions: [],
    tokenTransfers: [],
    approvals: [],
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
    mockRpc = {
      enrichTransaction: jest.fn(),
      createBaseTransaction: jest.fn(),
    };
    mockStoryGenerator = {
      generateStory: jest.fn().mockReturnValue({
        explanation: 'Transferred 1.5 ETH from 0x123... to 0xabc....',
        coverage: 'complete',
        coverageReasons: [],
        actions: [],
        tokenTransfers: [],
        approvals: [],
      }),
    };
    mockHistory = {
      recordSearch: jest.fn().mockResolvedValue({} as never),
    };

    service = new TransactionsService(
      mockPrisma as unknown as PrismaService,
      mockCache as unknown as CacheService,
      mockBlockchair as unknown as BlockchairService,
      mockRpc as unknown as EvmRpcService,
      mockStoryGenerator as unknown as StoryGeneratorService,
      mockHistory as unknown as HistoryService,
    );
  });

  it('returns cached data on cache hit without invoking providers and preserves original fetchedAt', async () => {
    mockCache.get.mockResolvedValue(mockEnrichedData as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockBaseTx.transactionHash,
      },
      mockSession,
      'test-request-id',
    );

    expect(result.data).toEqual(mockEnrichedData);
    expect(result.data.fetchedAt).toBe('2026-09-01T12:00:05.000Z'); // Preserved!
    expect(result.meta.cache.hit).toBe(true);
    expect(mockBlockchair.getTransaction).not.toHaveBeenCalled();
    expect(mockRpc.enrichTransaction).not.toHaveBeenCalled();
  });

  it('bypasses outdated or incomplete cache shape and triggers fresh fetch', async () => {
    // Legacy cache object missing actions, tokenTransfers, and fetchedAt
    const legacyCachedObject = {
      transactionHash: mockBaseTx.transactionHash,
      chain: 'ethereum',
      status: 'confirmed',
    };
    mockCache.get.mockResolvedValue(legacyCachedObject as never);

    mockBlockchair.getTransaction.mockResolvedValue({
      transaction: mockBaseTx,
      upstreamStatusCode: 200,
      providerDurationMs: 100,
    } as never);
    mockRpc.enrichTransaction.mockResolvedValue(mockEnrichment as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockBaseTx.transactionHash,
      },
      mockSession,
    );

    expect(mockBlockchair.getTransaction).toHaveBeenCalled();
    expect(result.data.explanation).toBeDefined();
    expect(result.meta.cache.hit).toBe(false);
  });

  it('bypasses cache write when status is pending (TTL = 0 policy)', async () => {
    const pendingTx: NormalizedTransaction = {
      ...mockBaseTx,
      status: 'pending',
      blockNumber: '0',
    };

    mockCache.get.mockResolvedValue(null as never);
    mockBlockchair.getTransaction.mockResolvedValue({
      transaction: pendingTx,
      upstreamStatusCode: 200,
      providerDurationMs: 100,
    } as never);
    mockRpc.enrichTransaction.mockResolvedValue({
      ...mockEnrichment,
      status: 'pending',
    } as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockBaseTx.transactionHash,
      },
      mockSession,
    );

    expect(result.data.status).toBe('pending');
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(mockHistory.recordSearch).toHaveBeenCalledWith(
      'db-session-uuid',
      expect.objectContaining({
        txStatus: 'pending',
        outcome: 'success',
      }),
    );
  });

  it('accurately records txStatus as failed on successful lookup of failed transaction', async () => {
    const failedTx: NormalizedTransaction = {
      ...mockBaseTx,
      status: 'failed',
    };

    mockCache.get.mockResolvedValue(null as never);
    mockBlockchair.getTransaction.mockResolvedValue({
      transaction: failedTx,
      upstreamStatusCode: 200,
      providerDurationMs: 120,
    } as never);
    mockRpc.enrichTransaction.mockResolvedValue({
      ...mockEnrichment,
      status: 'failed',
    } as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockBaseTx.transactionHash,
      },
      mockSession,
    );

    expect(result.data.status).toBe('failed');
    expect(mockHistory.recordSearch).toHaveBeenCalledWith(
      'db-session-uuid',
      expect.objectContaining({
        outcome: 'success', // Lookup succeeded
        txStatus: 'failed', // Blockchain execution status is failed
      }),
    );
  });

  it('flags status as unknown when Blockchair and RPC receipt disagree', async () => {
    // Blockchair claims confirmed, but RPC receipt indicates reverted 0x0
    const confirmedBlockchairTx: NormalizedTransaction = {
      ...mockBaseTx,
      status: 'confirmed',
    };

    mockCache.get.mockResolvedValue(null as never);
    mockBlockchair.getTransaction.mockResolvedValue({
      transaction: confirmedBlockchairTx,
      upstreamStatusCode: 200,
      providerDurationMs: 90,
    } as never);
    mockRpc.enrichTransaction.mockResolvedValue({
      ...mockEnrichment,
      status: 'failed', // Discrepancy!
      receipt: {
        ...mockEnrichment.receipt!,
        status: '0x0',
      },
    } as never);

    const result = await service.lookupTransaction(
      {
        chain: 'ethereum',
        transactionHash: mockBaseTx.transactionHash,
      },
      mockSession,
    );

    expect(result.data.status).toBe('unknown');
    expect(mockStoryGenerator.generateStory).toHaveBeenCalledWith(
      confirmedBlockchairTx,
      expect.anything(),
      'unknown',
      true, // hasDiscrepancy = true
    );
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
    mockRpc.enrichTransaction.mockResolvedValue({
      ...mockEnrichment,
      transaction: null,
      receipt: null,
    } as never);

    await expect(
      service.lookupTransaction({
        chain: 'ethereum',
        transactionHash: mockBaseTx.transactionHash,
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

  it('looks up BSC transaction directly via EVM RPC adapter without calling Blockchair', async () => {
    const bscTx: NormalizedTransaction = {
      ...mockBaseTx,
      chain: 'bsc',
      value: { raw: '1000000000000000000', formatted: '1.0', symbol: 'BNB' },
      fee: { raw: '100000000000000', formatted: '0.0001', symbol: 'BNB' },
    };

    mockCache.get.mockResolvedValue(null as never);
    mockRpc.enrichTransaction.mockResolvedValue(mockEnrichment as never);
    mockRpc.createBaseTransaction.mockReturnValue(bscTx);

    const result = await service.lookupTransaction(
      {
        chain: 'bsc',
        transactionHash: mockBaseTx.transactionHash,
      },
      mockSession,
    );

    expect(mockBlockchair.getTransaction).not.toHaveBeenCalled();
    expect(mockRpc.enrichTransaction).toHaveBeenCalledWith('bsc', mockBaseTx.transactionHash);
    expect(mockRpc.createBaseTransaction).toHaveBeenCalled();
    expect(result.data.chain).toBe('bsc');
    expect(mockPrisma.apiRequestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'evm_rpc',
          chain: 'bsc',
          outcome: 'success',
        }),
      }),
    );
  });

  it('looks up Polygon transaction directly via EVM RPC adapter without calling Blockchair', async () => {
    const polygonTx: NormalizedTransaction = {
      ...mockBaseTx,
      chain: 'polygon',
      value: { raw: '500000000000000000', formatted: '0.5', symbol: 'POL' },
      fee: { raw: '30000000000000', formatted: '0.00003', symbol: 'POL' },
    };

    mockCache.get.mockResolvedValue(null as never);
    mockRpc.enrichTransaction.mockResolvedValue(mockEnrichment as never);
    mockRpc.createBaseTransaction.mockReturnValue(polygonTx);

    const result = await service.lookupTransaction(
      {
        chain: 'polygon',
        transactionHash: mockBaseTx.transactionHash,
      },
      mockSession,
    );

    expect(mockBlockchair.getTransaction).not.toHaveBeenCalled();
    expect(mockRpc.enrichTransaction).toHaveBeenCalledWith('polygon', mockBaseTx.transactionHash);
    expect(mockRpc.createBaseTransaction).toHaveBeenCalled();
    expect(result.data.chain).toBe('polygon');
    expect(mockPrisma.apiRequestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'evm_rpc',
          chain: 'polygon',
          outcome: 'success',
        }),
      }),
    );
  });
});
