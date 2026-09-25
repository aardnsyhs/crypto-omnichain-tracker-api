import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { OverviewService } from './overview.service';
import { CacheService } from '../cache/cache.service';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { formatWeiToGwei } from '../common/utils/evm.utils';

describe('OverviewService (Blockchair-Only)', () => {
  let service: OverviewService;
  let blockchairClient: jest.Mocked<Pick<BlockchairClient, 'fetchChainStats'>>;

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
      fetchChainStats: jest.fn(),
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

  describe('Blockchair-Only Overview Flow', () => {
    it('uses Blockchair exclusively for Ethereum and marks BSC/Polygon as unavailable per API catalog evidence', async () => {
      const blockchairTime = '2026-09-24 12:59:11';
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: {
          best_block_height: 26047469,
          best_block_time: blockchairTime,
          market_price_usd: 2641.7,
          market_price_usd_change_24h_percentage: -2.85972,
          suggested_transaction_fee_gwei_options: {
            normal: 0.42,
          },
        },
        statusCode: 200,
        durationMs: 150,
        isRateLimited: false,
      } as never);

      const result = await service.getOverview();

      expect(result.data).toHaveLength(3);

      // 1. Ethereum: Must reflect Blockchair official stats
      const eth = result.data.find((item) => item.chain === 'ethereum');
      expect(eth).toBeDefined();
      expect(eth?.market?.source).toBe('Blockchair');
      expect(eth?.market?.priceUsd).toBe(2641.7);
      expect(eth?.market?.change24h).toBe(-2.85972);
      expect(eth?.market?.status).toBe('available');

      expect(eth?.network?.source).toBe('Blockchair');
      expect(eth?.network?.latestBlockNumber).toBe(26047469);
      expect(eth?.network?.blockDate).toBe(new Date('2026-09-24T12:59:11Z').toISOString());
      expect(eth?.network?.suggestedGasPriceGwei).toBe('0.42');
      expect(eth?.network?.status).toBe('available');

      // 2. BSC: Must retain row with explicit unavailable status and reason without fallback
      const bsc = result.data.find((item) => item.chain === 'bsc');
      expect(bsc).toBeDefined();
      expect(bsc?.market?.source).toBe('Blockchair');
      expect(bsc?.market?.status).toBe('unavailable');
      expect(bsc?.market?.priceUsd).toBeNull();
      expect(bsc?.market?.reason).toBe('Not indexed in Blockchair stats API catalog');
      expect(bsc?.network?.source).toBe('Blockchair');
      expect(bsc?.network?.status).toBe('unavailable');
      expect(bsc?.network?.latestBlockNumber).toBeNull();
      expect(bsc?.network?.reason).toBe('Not indexed in Blockchair stats API catalog');

      // 3. Polygon: Must retain row with explicit unavailable status and reason without fallback
      const pol = result.data.find((item) => item.chain === 'polygon');
      expect(pol).toBeDefined();
      expect(pol?.market?.source).toBe('Blockchair');
      expect(pol?.market?.status).toBe('unavailable');
      expect(pol?.market?.priceUsd).toBeNull();
      expect(pol?.market?.reason).toBe('Not indexed in Blockchair stats API catalog');
      expect(pol?.network?.source).toBe('Blockchair');
      expect(pol?.network?.status).toBe('unavailable');
      expect(pol?.network?.latestBlockNumber).toBeNull();
      expect(pol?.network?.reason).toBe('Not indexed in Blockchair stats API catalog');

      // Verify ONLY Blockchair was queried for Ethereum
      expect(blockchairClient.fetchChainStats).toHaveBeenCalledTimes(1);
      expect(blockchairClient.fetchChainStats).toHaveBeenCalledWith('ethereum');
    });

    it('correctly handles Ethereum 0 Gwei provider payload with gasNote context', async () => {
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: {
          best_block_height: 26056534,
          best_block_time: '2026-09-25 19:24:35',
          market_price_usd: 2693.99,
          market_price_usd_change_24h_percentage: 0.01947,
          suggested_transaction_fee_gwei_options: {
            sloth: 0,
            slow: 0,
            normal: 0,
            fast: 0,
            cheetah: 2,
          },
        },
        statusCode: 200,
        durationMs: 140,
        isRateLimited: false,
      } as never);

      const result = await service.getOverview();
      const eth = result.data.find((item) => item.chain === 'ethereum');

      expect(eth).toBeDefined();
      expect(eth?.network?.suggestedGasPriceGwei).toBe('0');
      expect(eth?.network?.suggestedGasPriceWei).toBe('0');
      expect(eth?.network?.gasNote).toBe('Provider estimated 0 Gwei under low congestion');
    });

    it('handles missing suggested gas without defaulting to 0', async () => {
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: {
          best_block_height: 26056534,
          best_block_time: '2026-09-25 19:24:35',
          market_price_usd: 2693.99,
          market_price_usd_change_24h_percentage: 0.01947,
          suggested_transaction_fee_gwei_options: null,
        },
        statusCode: 200,
        durationMs: 140,
        isRateLimited: false,
      } as never);

      const result = await service.getOverview();
      const eth = result.data.find((item) => item.chain === 'ethereum');

      expect(eth).toBeDefined();
      expect(eth?.network?.suggestedGasPriceGwei).toBeNull();
      expect(eth?.network?.suggestedGasPriceWei).toBeNull();
    });

    it('handles Blockchair rate limit (429) gracefully without throwing or falling back', async () => {
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: null,
        statusCode: 429,
        durationMs: 120,
        isRateLimited: true,
      } as never);

      const result = await service.getOverview();
      const eth = result.data.find((item) => item.chain === 'ethereum');

      expect(eth).toBeDefined();
      expect(eth?.market?.status).toBe('rate_limited');
      expect(eth?.market?.source).toBe('Blockchair');
      expect(eth?.network?.status).toBe('rate_limited');
      expect(eth?.network?.source).toBe('Blockchair');
    });

    it('serves stale Blockchair stats if live fetch fails and cache is within allowable window', async () => {
      const now = Date.now();
      const staleFetchedAt = new Date(now - 60 * 1000).toISOString(); // 1 minute ago
      mockCacheStore.set('overview:blockchair:v3:ethereum', {
        data: {
          priceUsd: 2600.0,
          change24h: 1.5,
          latestBlockNumber: 26040000,
          latestBlockTimestamp: Math.floor(now / 1000) - 60,
          blockDate: staleFetchedAt,
          suggestedGasPriceGwei: '1.2',
          suggestedGasPriceWei: '1200000000',
        },
        fetchedAt: staleFetchedAt,
        expiresAt: now - 10000, // Expired TTL, but within 300s max stale window
      });

      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: null,
        statusCode: 500,
        durationMs: 200,
        isRateLimited: false,
      } as never);

      const result = await service.getOverview();
      const eth = result.data.find((item) => item.chain === 'ethereum');

      expect(eth).toBeDefined();
      expect(eth?.market?.priceUsd).toBe(2600.0);
      expect(eth?.market?.isStale).toBe(true);
      expect(eth?.market?.status).toBe('stale');
      expect(eth?.network?.isStale).toBe(true);
      expect(eth?.network?.status).toBe('stale');
    });
  });
});
