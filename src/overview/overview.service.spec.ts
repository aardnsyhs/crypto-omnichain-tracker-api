import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { OverviewService } from './overview.service';
import { CacheService } from '../cache/cache.service';
import { CoinGeckoClient } from '../providers/coingecko/coingecko.client';
import { EvmRpcClient } from '../providers/rpc/evm-rpc.client';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { formatWeiToGwei } from '../common/utils/evm.utils';

describe('OverviewService', () => {
  let service: OverviewService;
  let coinGeckoClient: { fetchMarketPrices: ReturnType<typeof jest.fn> };
  let rpcClient: { getLatestBlockAndGas: ReturnType<typeof jest.fn> };
  let blockchairClient: { fetchChainStats: ReturnType<typeof jest.fn> };

  const mockCacheStore = new Map<string, any>();

  beforeEach(async () => {
    mockCacheStore.clear();

    const mockCache = {
      get: jest.fn().mockImplementation(((key: any) => Promise.resolve(mockCacheStore.get(key) || null)) as any),
      set: jest.fn().mockImplementation(((key: any, val: any) => {
        mockCacheStore.set(key, val);
        return Promise.resolve(true);
      }) as any),
      del: jest.fn().mockImplementation(((key: any) => {
        mockCacheStore.delete(key);
        return Promise.resolve(true);
      }) as any),
      isHealthy: jest.fn().mockReturnValue(true),
    };

    coinGeckoClient = {
      fetchMarketPrices: jest.fn(),
    };

    rpcClient = {
      getLatestBlockAndGas: jest.fn(),
    };

    blockchairClient = {
      fetchChainStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        { provide: CacheService, useValue: mockCache },
        { provide: CoinGeckoClient, useValue: coinGeckoClient },
        { provide: EvmRpcClient, useValue: rpcClient },
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

  describe('Blockchair Priority Flow for Ethereum', () => {
    it('uses Blockchair as primary source for Ethereum and CoinGecko/RPC for BSC and Polygon', async () => {
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

      const marketFetchedAt = '2026-09-24T12:00:00.000Z';
      coinGeckoClient.fetchMarketPrices.mockResolvedValueOnce({
        data: {
          ethereum: { priceUsd: 2650.0, change24h: 1.5 },
          binancecoin: { priceUsd: 770.0, change24h: -0.8 },
          'polygon-ecosystem-token': { priceUsd: 0.1, change24h: 0.0 },
        },
        isRateLimited: false,
        fetchedAt: marketFetchedAt,
      } as never);

      rpcClient.getLatestBlockAndGas.mockImplementation(((chain: string) => {
        if (chain === 'bsc') {
          return Promise.resolve({
            blockNumberHex: '0x7605c5b', // 123755611
            blockTimestampHex: '0x6aabefb5', // 1789657013
            gasPriceHex: '0x2faf080', // 50000000 wei -> 0.05 gwei
          });
        }
        if (chain === 'polygon') {
          return Promise.resolve({
            blockNumberHex: '0x59fe465', // 94364773
            blockTimestampHex: '0x6aabefba', // 1789657018
            gasPriceHex: '0x40d4e9183f', // 278449158207 wei
          });
        }
        return Promise.resolve({
          blockNumberHex: '0x18d7320',
          blockTimestampHex: '0x6aabefb0',
          gasPriceHex: '0x15d4d72d',
        });
      }) as never);

      const res = await service.getOverview();

      expect(res.data).toHaveLength(3);

      // 1. Ethereum: Must reflect Blockchair metrics and source
      const eth = res.data.find((d) => d.chain === 'ethereum')!;
      expect(eth.name).toBe('Ethereum');
      expect(eth.nativeSymbol).toBe('ETH');
      expect(eth.market?.priceUsd).toBe(2641.7);
      expect(eth.market?.change24h).toBe(-2.85972);
      expect(eth.market?.source).toBe('Blockchair');
      expect(eth.market?.status).toBe('available');

      expect(eth.network?.latestBlockNumber).toBe(26047469);
      expect(eth.network?.suggestedGasPriceGwei).toBe('0.42');
      expect(eth.network?.source).toBe('Blockchair');
      expect(eth.network?.status).toBe('available');

      // 2. BSC: Must reflect CoinGecko and EVM RPC with explicit sources
      const bsc = res.data.find((d) => d.chain === 'bsc')!;
      expect(bsc.name).toBe('BNB Smart Chain');
      expect(bsc.nativeSymbol).toBe('BNB');
      expect(bsc.market?.priceUsd).toBe(770.0);
      expect(bsc.market?.source).toBe('CoinGecko');
      expect(bsc.network?.latestBlockNumber).toBe(123755611);
      expect(bsc.network?.source).toBe('EVM RPC');

      // 3. Polygon: Must reflect CoinGecko and EVM RPC with explicit sources
      const pol = res.data.find((d) => d.chain === 'polygon')!;
      expect(pol.name).toBe('Polygon PoS');
      expect(pol.nativeSymbol).toBe('POL');
      expect(pol.market?.priceUsd).toBe(0.1);
      expect(pol.market?.source).toBe('CoinGecko');
      expect(pol.network?.latestBlockNumber).toBe(94364773);
      expect(pol.network?.source).toBe('EVM RPC');
    });

    it('gracefully falls back to CoinGecko and EVM RPC for Ethereum when Blockchair is unavailable', async () => {
      // Blockchair fails
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: null,
        statusCode: 503,
        durationMs: 300,
        isRateLimited: true,
      } as never);

      const marketFetchedAt = '2026-09-24T12:00:00.000Z';
      coinGeckoClient.fetchMarketPrices.mockResolvedValueOnce({
        data: {
          ethereum: { priceUsd: 2650.0, change24h: 1.5 },
          binancecoin: { priceUsd: 770.0, change24h: -0.8 },
          'polygon-ecosystem-token': { priceUsd: 0.1, change24h: 0.0 },
        },
        isRateLimited: false,
        fetchedAt: marketFetchedAt,
      } as never);

      rpcClient.getLatestBlockAndGas.mockImplementation(((chain: string) => {
        if (chain === 'ethereum') {
          return Promise.resolve({
            blockNumberHex: '0x18d7320', // 26047264
            blockTimestampHex: '0x6aabefb0', // 1789657008
            gasPriceHex: '0x15d4d72d', // 366270253 wei -> 0.366270253 gwei
          });
        }
        return Promise.resolve({
          blockNumberHex: '0x100',
          blockTimestampHex: '0x1000',
          gasPriceHex: '0x100',
        });
      }) as never);

      const res = await service.getOverview();

      const eth = res.data.find((d) => d.chain === 'ethereum')!;
      // Fallback market source must explicitly be CoinGecko, NEVER Blockchair
      expect(eth.market?.source).toBe('CoinGecko');
      expect(eth.market?.priceUsd).toBe(2650.0);

      // Fallback network source must explicitly be EVM RPC, NEVER Blockchair
      expect(eth.network?.source).toBe('EVM RPC');
      expect(eth.network?.latestBlockNumber).toBe(26047264);
      expect(eth.network?.suggestedGasPriceGwei).toBe('0.366270253');
    });

    it('serves stale Blockchair stats within allowable window when live call fails', async () => {
      const originalTime = new Date(Date.now() - 100 * 1000).toISOString();
      mockCacheStore.set('overview:blockchair:v1:ethereum', {
        data: {
          priceUsd: 2630.0,
          change24h: -1.2,
          latestBlockNumber: 26047000,
          latestBlockTimestamp: 1789650000,
          blockDate: '2026-09-24T12:00:00.000Z',
          suggestedGasPriceGwei: '0.45',
          suggestedGasPriceWei: '450000000',
        },
        fetchedAt: originalTime,
        expiresAt: Date.now() - 5000, // expired
      });

      // Live call returns rate limited
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: null,
        statusCode: 429,
        durationMs: 100,
        isRateLimited: true,
      } as never);

      const result = await service.resolveBlockchairStats('ethereum');

      expect(result.isStale).toBe(true);
      expect(result.status).toBe('stale');
      expect(result.updatedAt).toBe(originalTime);
      expect(result.stats?.priceUsd).toBe(2630.0);
      expect(result.stats?.latestBlockNumber).toBe(26047000);
    });
  });

  describe('Partial Chain & Market Provider Failure Scenarios', () => {
    it('handles one chain RPC failing while other chains succeed', async () => {
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: null,
        statusCode: 500,
        durationMs: 50,
        isRateLimited: false,
      } as never);

      coinGeckoClient.fetchMarketPrices.mockResolvedValueOnce({
        data: {
          ethereum: { priceUsd: 2600.0, change24h: 1.0 },
          binancecoin: { priceUsd: 760.0, change24h: 2.0 },
          'polygon-ecosystem-token': { priceUsd: 0.12, change24h: 3.0 },
        },
        isRateLimited: false,
        fetchedAt: new Date().toISOString(),
      } as never);

      rpcClient.getLatestBlockAndGas.mockImplementation(((chain: string) => {
        if (chain === 'ethereum') {
          return Promise.resolve({
            blockNumberHex: '0x18d7320',
            blockTimestampHex: '0x6aabefb0',
            gasPriceHex: '0x15d4d72d',
          });
        }
        if (chain === 'bsc') {
          // BSC fails
          return Promise.reject(new Error('Connection timeout to BSC node'));
        }
        return Promise.resolve({
          blockNumberHex: '0x59fe465',
          blockTimestampHex: '0x6aabefba',
          gasPriceHex: '0x40d4e9183f',
        });
      }) as never);

      const res = await service.getOverview();

      expect(res.data).toHaveLength(3);

      const eth = res.data.find((d) => d.chain === 'ethereum')!;
      expect(eth.network?.status).toBe('available');
      expect(eth.network?.latestBlockNumber).toBe(26047264);

      const bsc = res.data.find((d) => d.chain === 'bsc')!;
      expect(bsc.network?.status).toBe('unavailable');
      expect(bsc.network?.latestBlockNumber).toBeNull();
      expect(bsc.network?.suggestedGasPriceGwei).toBeNull();

      const pol = res.data.find((d) => d.chain === 'polygon')!;
      expect(pol.network?.status).toBe('available');
      expect(pol.network?.latestBlockNumber).toBe(94364773);
    });

    it('handles market provider complete failure (429) while network data remains available', async () => {
      blockchairClient.fetchChainStats.mockResolvedValueOnce({
        data: null,
        statusCode: 429,
        durationMs: 50,
        isRateLimited: true,
      } as never);

      coinGeckoClient.fetchMarketPrices.mockResolvedValueOnce({
        data: null,
        isRateLimited: true,
        error: 'Rate limited 429',
        fetchedAt: new Date().toISOString(),
      } as never);

      rpcClient.getLatestBlockAndGas.mockResolvedValue({
        blockNumberHex: '0x18d7320',
        blockTimestampHex: '0x6aabefb0',
        gasPriceHex: '0x15d4d72d',
      } as never);

      const res = await service.getOverview();

      const eth = res.data.find((d) => d.chain === 'ethereum')!;
      expect(eth.market?.status).toBe('rate_limited');
      expect(eth.market?.priceUsd).toBeNull();

      expect(eth.network?.status).toBe('available');
      expect(eth.network?.latestBlockNumber).toBe(26047264);
    });
  });
});
