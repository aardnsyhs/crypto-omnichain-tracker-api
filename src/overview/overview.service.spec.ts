import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { OverviewService } from './overview.service';
import { CacheService } from '../cache/cache.service';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { formatWeiToGwei } from '../common/utils/evm.utils';
import { ACTIVE_CHAINS } from '../common/constants/network-registry';

describe('OverviewService (Blockchair Multichain 6-Network)', () => {
  let service: OverviewService;
  let blockchairClient: {
    fetchGlobalStats: jest.Mock<any>;
    fetchChainStats: jest.Mock<any>;
  };

  const mockCacheStore = new Map<string, unknown>();

  beforeEach(async () => {
    mockCacheStore.clear();

    const mockCache: jest.Mocked<Pick<CacheService, 'get' | 'set' | 'del' | 'isHealthy'>> = {
      get: jest.fn<(key: string) => Promise<unknown>>().mockImplementation((key: string) => {
        const item = mockCacheStore.get(key);
        return Promise.resolve(item ?? null);
      }) as unknown as jest.MockedFunction<CacheService['get']>,
      set: jest
        .fn<(key: string, val: unknown) => Promise<boolean>>()
        .mockImplementation((key: string, val: unknown) => {
          mockCacheStore.set(key, val);
          return Promise.resolve(true);
        }) as unknown as jest.MockedFunction<CacheService['set']>,
      del: jest.fn<(key: string) => Promise<boolean>>().mockImplementation((key: string) => {
        mockCacheStore.delete(key);
        return Promise.resolve(true);
      }) as unknown as jest.MockedFunction<CacheService['del']>,
      isHealthy: jest.fn<() => boolean>().mockReturnValue(true),
    };

    blockchairClient = {
      fetchGlobalStats: jest.fn() as any,
      fetchChainStats: (jest.fn() as any).mockResolvedValue({
        data: null,
        statusCode: 404,
        durationMs: 0,
        isRateLimited: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        { provide: CacheService, useValue: mockCache },
        { provide: BlockchairClient, useValue: blockchairClient },
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('formatWeiToGwei utility', () => {
    it('converts Wei to Gwei accurately with null safety', () => {
      expect(formatWeiToGwei(null)).toBeNull();
      expect(formatWeiToGwei(undefined)).toBeNull();
      expect(formatWeiToGwei('0')).toBe('0');
      expect(formatWeiToGwei('0x0')).toBe('0');
      expect(formatWeiToGwei('50000000')).toBe('0.05');
      expect(formatWeiToGwei('366270253')).toBe('0.366270253');
      expect(formatWeiToGwei('275556518466')).toBe('275.556518466');
      expect(formatWeiToGwei('0x13c0042b')).toBe('0.331351083');
    });
  });

  describe('Multichain Overview Batch Flow', () => {
    it('batches all 6 active networks from Blockchair /stats with exact units', async () => {
      blockchairClient.fetchGlobalStats.mockResolvedValueOnce({
        data: {
          ethereum: {
            best_block_height: 26061078,
            best_block_time: '2026-09-26 10:38:23',
            market_price_usd: 2687.34,
            market_price_usd_change_24h_percentage: -0.91819,
            suggested_transaction_fee_gwei_options: {
              normal: 0.42,
            },
          },
          bitcoin: {
            best_block_height: 968673,
            best_block_time: '2026-09-26 10:33:41',
            market_price_usd: 84128,
            market_price_usd_change_24h_percentage: -0.68355,
            suggested_transaction_fee_per_byte_sat: 2,
          },
          litecoin: {
            best_block_height: 3184643,
            best_block_time: '2026-09-26 10:37:40',
            market_price_usd: 74.66,
            market_price_usd_change_24h_percentage: 5.84,
            suggested_transaction_fee_per_byte_sat: 1,
          },
          dogecoin: {
            best_block_height: 6390182,
            best_block_time: '2026-09-26 10:37:05',
            market_price_usd: 0.09798,
            market_price_usd_change_24h_percentage: 1.38,
            suggested_transaction_fee_per_byte_sat: 500000,
          },
          'bitcoin-cash': {
            best_block_height: 970311,
            best_block_time: '2026-09-26 10:33:06',
            market_price_usd: 338.17,
            market_price_usd_change_24h_percentage: -0.33,
            suggested_transaction_fee_per_byte_sat: 1,
          },
          dash: {
            best_block_height: 2545239,
            best_block_time: '2026-09-26 10:34:59',
            market_price_usd: 64.17,
            market_price_usd_change_24h_percentage: 1.3,
            suggested_transaction_fee_per_byte_sat: 1,
          },
        },
        statusCode: 200,
        durationMs: 250,
        isRateLimited: false,
      });

      const result = await service.getOverview();

      expect(result.data).toHaveLength(6);
      expect(result.data.map((d) => d.chain)).toEqual(ACTIVE_CHAINS);

      // 1. Ethereum: Gwei unit
      const eth = result.data.find((item) => item.chain === 'ethereum');
      expect(eth).toBeDefined();
      expect(eth?.market?.priceUsd).toBe(2687.34);
      expect(eth?.network?.latestBlockNumber).toBe(26061078);
      expect(eth?.network?.suggestedFeeRate).toBe('0.42');
      expect(eth?.network?.feeUnit).toBe('Gwei');

      // 2. Bitcoin: sat/byte unit
      const btc = result.data.find((item) => item.chain === 'bitcoin');
      expect(btc).toBeDefined();
      expect(btc?.market?.priceUsd).toBe(84128);
      expect(btc?.network?.latestBlockNumber).toBe(968673);
      expect(btc?.network?.suggestedFeeRate).toBe('2');
      expect(btc?.network?.feeUnit).toBe('sat/byte');

      // 3. Dogecoin: 500,000 sat/byte
      const doge = result.data.find((item) => item.chain === 'dogecoin');
      expect(doge).toBeDefined();
      expect(doge?.market?.priceUsd).toBe(0.09798);
      expect(doge?.network?.latestBlockNumber).toBe(6390182);
      expect(doge?.network?.suggestedFeeRate).toBe('500000');
      expect(doge?.network?.feeUnit).toBe('sat/byte');

      // Single batch fetch was used
      expect(blockchairClient.fetchGlobalStats).toHaveBeenCalledTimes(1);
    });

    it('correctly handles Ethereum 0 Gwei low congestion estimate note', async () => {
      blockchairClient.fetchGlobalStats.mockResolvedValueOnce({
        data: {
          ethereum: {
            best_block_height: 26061078,
            best_block_time: '2026-09-26 10:38:23',
            market_price_usd: 2687.34,
            market_price_usd_change_24h_percentage: -0.91,
            suggested_transaction_fee_gwei_options: {
              normal: 0,
            },
          },
        },
        statusCode: 200,
        durationMs: 200,
        isRateLimited: false,
      });

      const result = await service.getOverview();
      const eth = result.data.find((item) => item.chain === 'ethereum');

      expect(eth?.network?.suggestedFeeRate).toBe('0');
      expect(eth?.network?.feeRateNote).toBe('Provider estimated 0 Gwei under low congestion');
    });

    it('serves stale cached data if live fetch fails within allowable window', async () => {
      const now = Date.now();
      const staleEnvelope = {
        items: ACTIVE_CHAINS.map((chain) => ({
          chain,
          name: chain,
          nativeSymbol: chain.toUpperCase(),
          family: (chain === 'ethereum' ? 'evm' : 'utxo') as 'evm' | 'utxo',
          market: {
            priceUsd: 100,
            change24h: 1,
            source: 'Blockchair',
            updatedAt: new Date(now - 120000).toISOString(),
            isStale: false,
            status: 'available' as const,
            reason: null,
          },
          network: {
            latestBlockNumber: 12345,
            latestBlockTimestamp: Math.floor(now / 1000) - 120,
            blockDate: new Date(now - 120000).toISOString(),
            suggestedFeeRate: '1',
            feeUnit: 'sat/byte',
            source: 'Blockchair',
            updatedAt: new Date(now - 120000).toISOString(),
            isStale: false,
            status: 'available' as const,
            reason: null,
          },
        })),
        fetchedAt: new Date(now - 120000).toISOString(),
        expiresAt: now - 60000, // expired 1 minute ago, but inside 300s max stale
      };

      mockCacheStore.set('overview:blockchair:v4:all', staleEnvelope);
      blockchairClient.fetchGlobalStats.mockRejectedValueOnce(new Error('Network offline'));

      const result = await service.getOverview();

      expect(result.data).toHaveLength(6);
      expect(result.data[0].market?.isStale).toBe(true);
      expect(result.data[0].market?.status).toBe('stale');
      expect(result.meta.cached).toBe(true);
    });
  });
});
