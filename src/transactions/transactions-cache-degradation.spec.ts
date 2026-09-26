import { jest } from '@jest/globals';
import { TransactionsService } from './transactions.service';
import { TokenMetadataCache } from '../providers/rpc/token-metadata.cache';
import { EvmRpcService } from '../providers/rpc/evm-rpc.service';
import { EvmLogDecoder } from './story/evm-log.decoder';
import { StoryGeneratorService } from './story/story-generator.service';
import type { EvmRpcClient } from '../providers/rpc/evm-rpc.client';
import type { CacheService } from '../cache/cache.service';
import type { BlockchairService } from '../providers/blockchair/blockchair.service';
import type { PrismaService } from '../database/prisma.service';
import type { HistoryService } from '../history/history.service';
import type { NormalizedTransaction } from '../providers/blockchair/blockchair.interface';
import { ERC20_TRANSFER_TOPIC0 } from '../providers/rpc/evm-rpc.constants';
import {
  DEFAULT_TRANSACTION_CACHE_TTL_DEGRADED,
  DEFAULT_TRANSACTION_CACHE_TTL_SECONDS,
} from '../cache/cache.constants';

describe('Transaction Cache & Metadata Degradation Recovery (Regression Test)', () => {
  const tokenContract = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const txHash = '0xc210798f290bca417115120cf5b70909adbebbe62008edf37e9b9884b7274258';

  const baseTxFixture: NormalizedTransaction = {
    transactionHash: txHash,
    chain: 'ethereum',
    status: 'confirmed',
    blockNumber: '26000000',
    timestamp: '2026-09-23T12:00:00Z',
    from: '0x1111111111111111111111111111111111111111',
    to: tokenContract,
    value: { raw: '0', formatted: '0', symbol: 'ETH' },
    fee: { raw: '21000', formatted: '0.000021', symbol: 'ETH' },
    explorerUrl: `https://etherscan.io/tx/${txHash}`,
  };

  const transferLog = {
    address: tokenContract,
    topics: [
      ERC20_TRANSFER_TOPIC0,
      '0x0000000000000000000000001111111111111111111111111111111111111111',
      '0x0000000000000000000000002222222222222222222222222222222222222222',
    ],
    // 100000000 (100.0 with 6 decimals)
    data: '0x0000000000000000000000000000000000000000000000000000000005f5e100',
    logIndex: '0x1',
  };

  beforeEach(() => {
    jest.useRealTimers();
  });

  it('TokenMetadataCache correctly uses 60s degraded TTL for single-field transient failure and expires after 60s', () => {
    jest.useFakeTimers();
    try {
      const cache = new TokenMetadataCache();

      // Partial failure: symbol resolved successfully, but decimals failed due to transient error
      cache.set('ethereum', tokenContract, {
        contractAddress: tokenContract,
        chain: 'ethereum',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: null,
        isDegraded: true,
        failureReasons: ['decimals: RPC connection timeout'],
      });

      // 1. Immediately available
      expect(cache.get('ethereum', tokenContract)).not.toBeNull();
      expect(cache.get('ethereum', tokenContract)?.symbol).toBe('USDC');
      expect(cache.get('ethereum', tokenContract)?.decimals).toBeNull();

      // 2. Advance time by 30 seconds (still within degraded TTL)
      jest.advanceTimersByTime(30 * 1000);
      expect(cache.get('ethereum', tokenContract)).not.toBeNull();

      // 3. Advance time past degraded TTL (60s total + 1s = 61s)
      jest.advanceTimersByTime(31 * 1000);
      expect(cache.get('ethereum', tokenContract)).toBeNull(); // Expired! Does not persist for 24h
    } finally {
      jest.useRealTimers();
    }
  });

  it('TokenMetadataCache preserves complete metadata (non-degraded) for 24 hours', () => {
    jest.useFakeTimers();
    try {
      const cache = new TokenMetadataCache();

      // Clean metadata: decimals: 0 (valid zero decimals) and symbol: 'TOKEN'
      cache.set('ethereum', tokenContract, {
        contractAddress: tokenContract,
        chain: 'ethereum',
        symbol: 'TOKEN',
        name: 'Zero Decimal Token',
        decimals: 0, // valid 0 decimals
        isDegraded: false,
      });

      // Advance 61 seconds (past degraded TTL)
      jest.advanceTimersByTime(61 * 1000);
      // Should still exist because it is non-degraded (24h TTL)
      expect(cache.get('ethereum', tokenContract)).not.toBeNull();
      expect(cache.get('ethereum', tokenContract)?.decimals).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('End-to-end recovery: transient partial failure is cached with degraded 60s TTL, expires, and fully recovers on subsequent lookup', async () => {
    jest.useFakeTimers();
    try {
      // 1. Simulated Redis cache store with expiration tracking
      const redisStore = new Map<string, { data: unknown; expiresAt: number }>();
    const mockCacheService = {
      get: jest.fn(async (key: string) => {
        const entry = redisStore.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
          redisStore.delete(key);
          return null;
        }
        return entry.data;
      }),
      set: jest.fn(async (key: string, data: unknown, ttlSeconds: number) => {
        if (ttlSeconds <= 0) return false;
        redisStore.set(key, {
          data,
          expiresAt: Date.now() + ttlSeconds * 1000,
        });
        return true;
      }),
    } as unknown as CacheService;

    // 2. Mock RPC Client
    const mockRpcClient = {
      verifyChainId: jest.fn().mockResolvedValue(undefined as never),
      getTransactionReceipt: jest.fn().mockResolvedValue({
        status: '0x1',
        gasUsed: '0x5208',
        logs: [transferLog],
      } as never),
      getTransactionByHash: jest.fn().mockResolvedValue({
        input: '0xa9059cbb...',
      } as never),
      getCode: jest.fn().mockResolvedValue('0x60806040...' as never),
      fetchTokenMetadata: jest.fn(),
    };

    const metadataCache = new TokenMetadataCache();
    const rpcService = new EvmRpcService(mockRpcClient as unknown as EvmRpcClient, metadataCache);
    const decoder = new EvmLogDecoder();
    const storyGenerator = new StoryGeneratorService(decoder);

    const mockBlockchairService = {
      getTransaction: jest.fn().mockResolvedValue({
        transaction: baseTxFixture,
        upstreamStatusCode: 200,
        providerDurationMs: 50,
      } as never),
    } as unknown as BlockchairService;

    const mockPrisma = {
      apiRequestLog: { create: jest.fn().mockResolvedValue({} as never) },
    } as unknown as PrismaService;

    const mockHistory = {
      recordSearch: jest.fn().mockResolvedValue({} as never),
    } as unknown as HistoryService;

    const transactionsService = new TransactionsService(
      mockPrisma,
      mockCacheService,
      mockBlockchairService,
      rpcService,
      storyGenerator,
      mockHistory,
    );

    // FIRST LOOKUP: Simulate transient failure on decimals (e.g. RPC timeout), symbol succeeds
    mockRpcClient.fetchTokenMetadata.mockResolvedValueOnce({
      contractAddress: tokenContract,
      chain: 'ethereum',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: null, // decimals call failed!
      isDegraded: true,
      failureReasons: ['decimals: timeout'],
    } as never);

    const firstResult = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
    });

    // Verify first result has partial coverage and missing decimals
    expect(firstResult.data.coverage).toBe('partial');
    expect(firstResult.data.coverageReasons).toContain('metadata_unavailable');
    expect(firstResult.data.coverageReasons).toContain('temporary_enrichment_failure');
    expect(firstResult.data.tokenTransfers![0].decimals).toBeNull();
    expect(firstResult.data.tokenTransfers![0].formattedAmount).toBeNull();

    // Verify Redis cache received degraded TTL (60 seconds)
    const redisKey = `transaction:v2:ethereum:${txHash}`;
    expect(mockCacheService.set).toHaveBeenCalledWith(
      redisKey,
      expect.anything(),
      DEFAULT_TRANSACTION_CACHE_TTL_DEGRADED, // 60s
    );

    // Immediate second lookup hits the cache and returns the cached partial result
    const cachedResult = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
    });
    expect(cachedResult.meta.cache.hit).toBe(true);

    // ADVANCE CLOCK by 61 seconds (past 60s degraded TTL)
    jest.advanceTimersByTime(61 * 1000);

    // Verify both caches have expired
    expect(await mockCacheService.get(redisKey)).toBeNull();
    expect(metadataCache.get('ethereum', tokenContract)).toBeNull();

    // THIRD LOOKUP (AFTER 60s): RPC has recovered and now returns complete metadata!
    mockRpcClient.fetchTokenMetadata.mockResolvedValueOnce({
      contractAddress: tokenContract,
      chain: 'ethereum',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6, // Recovered!
      isDegraded: false,
    } as never);

    const recoveredResult = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
    });

    // Verify lookup was a cache miss and successfully recovered
    expect(recoveredResult.meta.cache.hit).toBe(false);
    expect(recoveredResult.data.coverage).toBe('complete');
    expect(recoveredResult.data.coverageReasons).not.toContain('metadata_unavailable');
    expect(recoveredResult.data.coverageReasons).not.toContain('temporary_enrichment_failure');
    expect(recoveredResult.data.tokenTransfers![0].symbol).toBe('USDC');
    expect(recoveredResult.data.tokenTransfers![0].decimals).toBe(6);
    expect(recoveredResult.data.tokenTransfers![0].formattedAmount).toBe('100'); // 100.0 USDC decoded!
    expect(recoveredResult.data.explanation).toContain('Transferred 100 USDC');

    // Verify Redis was re-cached with full 3600s TTL!
    expect(mockCacheService.set).toHaveBeenLastCalledWith(
      redisKey,
      expect.anything(),
      DEFAULT_TRANSACTION_CACHE_TTL_SECONDS, // 3600s
    );

    // Verify memory cache now retains the non-degraded entry for 24h
    expect(metadataCache.get('ethereum', tokenContract)?.decimals).toBe(6);
    } finally {
      jest.useRealTimers();
    }
  });

  it('assigns 60s degraded TTL when receipt is unavailable, allowing recovery on refresh or after expiry', async () => {
    const memoryStore = new Map<string, { value: unknown; expiresAt: number }>();
    const mockCacheService: jest.Mocked<Pick<CacheService, 'get' | 'set' | 'del' | 'isHealthy'>> =
      {
        get: jest.fn<(key: string) => Promise<unknown>>().mockImplementation((key: string) => {
          const item = memoryStore.get(key);
          if (!item) return Promise.resolve(null);
          if (Date.now() > item.expiresAt) {
            memoryStore.delete(key);
            return Promise.resolve(null);
          }
          return Promise.resolve(item.value);
        }) as unknown as jest.MockedFunction<CacheService['get']>,
        set: jest
          .fn<(key: string, val: unknown, ttl: number) => Promise<boolean>>()
          .mockImplementation((key: string, val: unknown, ttl: number) => {
            memoryStore.set(key, { value: val, expiresAt: Date.now() + ttl * 1000 });
            return Promise.resolve(true);
          }) as unknown as jest.MockedFunction<CacheService['set']>,
        del: jest.fn<(key: string) => Promise<boolean>>().mockImplementation((key: string) => {
          memoryStore.delete(key);
          return Promise.resolve(true);
        }) as unknown as jest.MockedFunction<CacheService['del']>,
        isHealthy: jest.fn<() => boolean>().mockReturnValue(true),
      };

    const nativeTxFixture: NormalizedTransaction = {
      ...baseTxFixture,
      to: '0x2222222222222222222222222222222222222222',
      value: { raw: '1000000000000000000', formatted: '1.0', symbol: 'ETH' },
    };

    const mockBlockchairService = {
      getTransaction: jest.fn().mockResolvedValue({
        transaction: nativeTxFixture,
        upstreamStatusCode: 200,
        providerDurationMs: 100,
      } as never),
    };

    const mockRpcClient = {
      getTransactionReceipt: jest.fn(),
      getTransactionByHash: jest.fn().mockResolvedValue({
        hash: txHash,
        from: nativeTxFixture.from,
        to: nativeTxFixture.to,
        value: '0xde0b6b3a7640000',
        input: '0x',
        blockNumber: '0x18ca4a0',
        blockHash: '0xabc',
        gas: '21000',
        nonce: '0',
      } as never),
      getCode: jest.fn().mockResolvedValue('0x' as never), // EOA
      getBlockByNumber: jest.fn().mockResolvedValue({ number: '0x18ca4a0', timestamp: '0x6ab3a157' } as never),
      fetchTokenMetadata: jest.fn(),
      getGasPrice: jest.fn(),
      getLatestBlockAndGas: jest.fn(),
    };

    const rpcService = new EvmRpcService(
      mockRpcClient as unknown as EvmRpcClient,
      new TokenMetadataCache(),
    );
    const storyGenerator = new StoryGeneratorService(new EvmLogDecoder());
    const mockPrisma = {
      apiRequestLog: { create: jest.fn().mockResolvedValue({} as never) },
      searchHistory: { create: jest.fn().mockResolvedValue({} as never) },
    };
    const mockHistory = { recordSearch: jest.fn().mockResolvedValue({} as never) };

    const transactionsService = new TransactionsService(
      mockPrisma as unknown as PrismaService,
      mockCacheService as unknown as CacheService,
      mockBlockchairService as unknown as BlockchairService,
      rpcService,
      storyGenerator,
      mockHistory as unknown as HistoryService,
    );

    // FIRST LOOKUP: receipt returns null (temporary outage)
    mockRpcClient.getTransactionReceipt.mockResolvedValue(null as never);

    const partialResult = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
    });

    expect(partialResult.data.coverageReasons).toContain('receipt_unavailable');
    expect(partialResult.data.coverage).toBe('partial');
    expect(partialResult.data.explanation).toContain('Transaction data is incomplete');

    // MUST be cached with degraded 60s TTL, NOT 3600s!
    expect(mockCacheService.set).toHaveBeenCalledWith(
      expect.stringContaining(txHash),
      expect.anything(),
      DEFAULT_TRANSACTION_CACHE_TTL_DEGRADED, // 60s
    );

    // Cache hit during degraded window
    const hitResult = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
    });
    expect(hitResult.meta.cache.hit).toBe(true);

    // Manual / Retry refresh (refresh: true) bypasses cache and re-queries provider
    mockRpcClient.getTransactionReceipt.mockResolvedValueOnce({
      transactionHash: txHash,
      transactionIndex: '0x1',
      blockHash: '0xabc',
      blockNumber: '0x18ca4a0',
      from: nativeTxFixture.from,
      to: nativeTxFixture.to,
      cumulativeGasUsed: '21000',
      gasUsed: '21000',
      contractAddress: null,
      logs: [],
      status: '0x1',
    } as never);

    const refreshedResult = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
      refresh: true,
    });

    expect(refreshedResult.meta.cache.hit).toBe(false);
    expect(refreshedResult.data.coverageReasons).not.toContain('receipt_unavailable');
    expect(refreshedResult.data.coverage).toBe('complete');
    // Now cached with full 3600s TTL!
    expect(mockCacheService.set).toHaveBeenLastCalledWith(
      expect.stringContaining(txHash),
      expect.anything(),
      DEFAULT_TRANSACTION_CACHE_TTL_SECONDS, // 3600s
    );
  });

  it('enforces monotonicity: poorer degraded response does not overwrite complete cached response for same block', async () => {
    const memoryStore = new Map<string, unknown>();
    const mockCacheService: jest.Mocked<Pick<CacheService, 'get' | 'set' | 'del' | 'isHealthy'>> =
      {
        get: jest.fn<(key: string) => Promise<unknown>>().mockImplementation((key: string) => {
          return Promise.resolve(memoryStore.get(key) ?? null);
        }) as unknown as jest.MockedFunction<CacheService['get']>,
        set: jest
          .fn<(key: string, val: unknown, ttl: number) => Promise<boolean>>()
          .mockImplementation((key: string, val: unknown) => {
            memoryStore.set(key, val);
            return Promise.resolve(true);
          }) as unknown as jest.MockedFunction<CacheService['set']>,
        del: jest.fn<(key: string) => Promise<boolean>>().mockImplementation((key: string) => {
          memoryStore.delete(key);
          return Promise.resolve(true);
        }) as unknown as jest.MockedFunction<CacheService['del']>,
        isHealthy: jest.fn<() => boolean>().mockReturnValue(true),
      };

    const redisKey = `transaction:v2:ethereum:${txHash}`;
    // Pre-populate cache with complete transaction data for block 26000000
    memoryStore.set(redisKey, {
      transactionHash: txHash,
      chain: 'ethereum',
      status: 'confirmed',
      from: baseTxFixture.from,
      to: baseTxFixture.to,
      value: baseTxFixture.value,
      fee: baseTxFixture.fee,
      blockNumber: '26000000',
      timestamp: baseTxFixture.timestamp,
      explorerUrl: baseTxFixture.explorerUrl,
      fetchedAt: new Date().toISOString(),
      explanation: 'Transferred 100 USDC to recipient.',
      coverage: 'complete',
      coverageReasons: [],
      actions: [],
      tokenTransfers: [
        {
          tokenAddress: tokenContract,
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          from: baseTxFixture.from,
          to: baseTxFixture.to || '',
          rawAmount: '100000000',
          formattedAmount: '100',
          logIndex: 1,
        },
      ],
      approvals: [],
      technical: {
        gasUsed: '21000',
        inputData: '0x',
      },
    });

    const mockBlockchairService = {
      getTransaction: jest.fn().mockResolvedValue({
        transaction: baseTxFixture,
        upstreamStatusCode: 200,
        providerDurationMs: 100,
      } as never),
    };

    // RPC provider has transient glitch where receipt is null
    const mockRpcClient = {
      getTransactionReceipt: jest.fn().mockResolvedValue(null as never),
      getTransactionByHash: jest.fn().mockResolvedValue({
        hash: txHash,
        from: baseTxFixture.from,
        to: baseTxFixture.to,
        value: '0',
        input: '0x',
        blockNumber: '26000000',
      } as never),
      getCode: jest.fn().mockResolvedValue(null as never),
      getBlockByNumber: jest.fn().mockResolvedValue(null as never),
      fetchTokenMetadata: jest.fn(),
      getGasPrice: jest.fn(),
      getLatestBlockAndGas: jest.fn(),
    };

    const rpcService = new EvmRpcService(
      mockRpcClient as unknown as EvmRpcClient,
      new TokenMetadataCache(),
    );
    const storyGenerator = new StoryGeneratorService(new EvmLogDecoder());
    const mockPrisma = {
      apiRequestLog: { create: jest.fn().mockResolvedValue({} as never) },
      searchHistory: { create: jest.fn().mockResolvedValue({} as never) },
    };
    const mockHistory = { recordSearch: jest.fn().mockResolvedValue({} as never) };

    const transactionsService = new TransactionsService(
      mockPrisma as unknown as PrismaService,
      mockCacheService as unknown as CacheService,
      mockBlockchairService as unknown as BlockchairService,
      rpcService,
      storyGenerator,
      mockHistory as unknown as HistoryService,
    );

    // Refresh request triggered while RPC has transient glitch
    const result = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
      refresh: true,
    });

    // Monotonicity check ensures the existing complete data is preserved!
    expect(result.data.coverage).toBe('complete');
    expect(result.data.tokenTransfers).toHaveLength(1);
    expect(result.data.technical?.gasUsed).toBe('21000');
  });

  it('valid receipt with empty logs gets complete coverage and 3600s cache TTL', async () => {
    const mockCacheService: jest.Mocked<Pick<CacheService, 'get' | 'set' | 'del' | 'isHealthy'>> =
      {
        get: jest.fn().mockResolvedValue(null as never) as never,
        set: jest.fn().mockResolvedValue(true as never) as never,
        del: jest.fn().mockResolvedValue(true as never) as never,
        isHealthy: jest.fn().mockReturnValue(true as never) as never,
      };

    const nativeTxFixture: NormalizedTransaction = {
      ...baseTxFixture,
      to: '0x2222222222222222222222222222222222222222',
      value: { raw: '1000000000000000000', formatted: '1.0', symbol: 'ETH' },
    };

    const mockBlockchairService = {
      getTransaction: jest.fn().mockResolvedValue({
        transaction: nativeTxFixture,
        upstreamStatusCode: 200,
        providerDurationMs: 100,
      } as never),
    };

    const mockRpcClient = {
      getTransactionReceipt: jest.fn().mockResolvedValue({
        transactionHash: txHash,
        transactionIndex: '0x0',
        blockHash: '0xabc',
        blockNumber: '26000000',
        from: nativeTxFixture.from,
        to: nativeTxFixture.to,
        cumulativeGasUsed: '21000',
        gasUsed: '21000',
        contractAddress: null,
        logs: [], // Valid empty logs
        status: '0x1',
      } as never),
      getTransactionByHash: jest.fn().mockResolvedValue({
        hash: txHash,
        from: nativeTxFixture.from,
        to: nativeTxFixture.to,
        value: '0xde0b6b3a7640000',
        input: '0x',
        blockNumber: '26000000',
      } as never),
      getCode: jest.fn().mockResolvedValue('0x' as never), // EOA, not a contract
      getBlockByNumber: jest.fn().mockResolvedValue(null as never),
      fetchTokenMetadata: jest.fn(),
      getGasPrice: jest.fn(),
      getLatestBlockAndGas: jest.fn(),
    };

    const rpcService = new EvmRpcService(
      mockRpcClient as unknown as EvmRpcClient,
      new TokenMetadataCache(),
    );
    const storyGenerator = new StoryGeneratorService(new EvmLogDecoder());
    const mockPrisma = {
      apiRequestLog: { create: jest.fn().mockResolvedValue({} as never) },
      searchHistory: { create: jest.fn().mockResolvedValue({} as never) },
    };
    const mockHistory = { recordSearch: jest.fn().mockResolvedValue({} as never) };

    const transactionsService = new TransactionsService(
      mockPrisma as unknown as PrismaService,
      mockCacheService as unknown as CacheService,
      mockBlockchairService as unknown as BlockchairService,
      rpcService,
      storyGenerator,
      mockHistory as unknown as HistoryService,
    );

    const result = await transactionsService.lookupTransaction({
      chain: 'ethereum',
      transactionHash: txHash,
    });

    expect(result.data.coverageReasons).not.toContain('receipt_unavailable');
    expect(result.data.coverage).toBe('complete');
    expect(mockCacheService.set).toHaveBeenCalledWith(
      expect.stringContaining(txHash),
      expect.anything(),
      DEFAULT_TRANSACTION_CACHE_TTL_SECONDS, // Full 3600s
    );
  });
});
