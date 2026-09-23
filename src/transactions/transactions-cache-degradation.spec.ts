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
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('TokenMetadataCache correctly uses 60s degraded TTL for single-field transient failure and expires after 60s', () => {
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
  });

  it('TokenMetadataCache preserves complete metadata (non-degraded) for 24 hours', () => {
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
  });

  it('End-to-end recovery: transient partial failure is cached with degraded 60s TTL, expires, and fully recovers on subsequent lookup', async () => {
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
    expect(firstResult.data.tokenTransfers[0].decimals).toBeNull();
    expect(firstResult.data.tokenTransfers[0].formattedAmount).toBeNull();

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
    expect(recoveredResult.data.tokenTransfers[0].symbol).toBe('USDC');
    expect(recoveredResult.data.tokenTransfers[0].decimals).toBe(6);
    expect(recoveredResult.data.tokenTransfers[0].formattedAmount).toBe('100'); // 100.0 USDC decoded!
    expect(recoveredResult.data.explanation).toContain('Transferred 100 USDC');

    // Verify Redis was re-cached with full 3600s TTL!
    expect(mockCacheService.set).toHaveBeenLastCalledWith(
      redisKey,
      expect.anything(),
      DEFAULT_TRANSACTION_CACHE_TTL_SECONDS, // 3600s
    );

    // Verify memory cache now retains the non-degraded entry for 24h
    expect(metadataCache.get('ethereum', tokenContract)?.decimals).toBe(6);
  });
});
