import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { EvmRpcClient } from '../providers/rpc/evm-rpc.client';
import { CoinGeckoClient } from '../providers/coingecko/coingecko.client';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { isBlockchairSupportedChain } from '../providers/blockchair/blockchair.constants';
import {
  CHAIN_DISPLAY_NAMES,
  CHAIN_NATIVE_SYMBOLS,
  COINGECKO_COIN_IDS,
  SUPPORTED_OVERVIEW_CHAINS,
  type OverviewChain,
} from '../providers/coingecko/coingecko.constants';
import {
  OVERVIEW_MARKET_CACHE_KEY,
  OVERVIEW_MARKET_CACHE_TTL_SECONDS,
  OVERVIEW_MARKET_MAX_STALE_SECONDS,
  OVERVIEW_NETWORK_CACHE_TTL_SECONDS,
  OVERVIEW_NETWORK_MAX_STALE_SECONDS,
  OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS,
  OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS,
  buildOverviewNetworkCacheKey,
  buildOverviewBlockchairCacheKey,
} from './overview.constants';
import type {
  CachedMarketEnvelope,
  CachedNetworkEnvelope,
  CachedBlockchairStatsEnvelope,
  ChainNetworkData,
  CoinMarketData,
  NetworkOverviewItem,
  OverviewResponse,
} from './overview.interface';
import { formatWeiToGwei } from '../common/utils/evm.utils';

@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  // In-flight request deduplication maps to prevent cache stampedes
  private inFlightBlockchairPromises = new Map<
    string,
    Promise<{
      envelope: CachedBlockchairStatsEnvelope | null;
      isRateLimited: boolean;
    }>
  >();

  private inFlightMarketPromise: Promise<{
    envelope: CachedMarketEnvelope | null;
    isRateLimited: boolean;
  }> | null = null;

  private inFlightNetworkPromises = new Map<
    string,
    Promise<CachedNetworkEnvelope | null>
  >();

  constructor(
    private readonly cacheService: CacheService,
    private readonly coinGeckoClient: CoinGeckoClient,
    private readonly rpcClient: EvmRpcClient,
    private readonly blockchairClient: BlockchairClient,
  ) {}

  /**
   * Retrieves the combined market and network overview for all supported chains.
   * Priority:
   * 1. Ethereum: Uses official Blockchair stats (/ethereum/stats) as primary source for both
   *    market data and network stats. If Blockchair is unavailable or rate-limited, falls back
   *    to CoinGecko for market data and EVM RPC for network stats.
   * 2. BSC & Polygon: Blockchair public API does not support them; uses CoinGecko (market)
   *    and EVM RPC (network) with explicit source attribution.
   */
  async getOverview(): Promise<OverviewResponse> {
    const serverFetchedAt = new Date().toISOString();

    // Fetch primary Blockchair stats for Ethereum, fallback/gap-filling market data, and RPCs in parallel
    const [blockchairEthResult, marketResult, networkResults] = await Promise.all([
      this.resolveBlockchairStats('ethereum'),
      this.resolveMarketData(),
      Promise.all(
        SUPPORTED_OVERVIEW_CHAINS.map(async (chain) => ({
          chain,
          data: await this.resolveNetworkData(chain),
        })),
      ),
    ]);

    const rpcNetworkMap = new Map<string, ChainNetworkData>(
      networkResults.map((r) => [r.chain, r.data]),
    );

    let allFresh = true;

    const items: NetworkOverviewItem[] = SUPPORTED_OVERVIEW_CHAINS.map((chain) => {
      const coinId = COINGECKO_COIN_IDS[chain];
      const coinGeckoQuote = marketResult.quotes[coinId];
      const rpcNetwork = rpcNetworkMap.get(chain) ?? this.createUnavailableNetworkData('EVM RPC');

      // Ethereum: Prioritize Blockchair data when available
      if (chain === 'ethereum' && blockchairEthResult.stats !== null) {
        const stats = blockchairEthResult.stats;
        const isStale = blockchairEthResult.isStale;
        const status = blockchairEthResult.status;

        if (isStale || status !== 'available') {
          allFresh = false;
        }

        const marketData: CoinMarketData = {
          priceUsd: stats.priceUsd,
          change24h: stats.change24h,
          source: 'Blockchair',
          updatedAt: blockchairEthResult.updatedAt,
          isStale,
          status,
        };

        const networkData: ChainNetworkData = {
          latestBlockNumber: stats.latestBlockNumber,
          latestBlockTimestamp: stats.latestBlockTimestamp,
          blockDate: stats.blockDate,
          suggestedGasPriceWei: stats.suggestedGasPriceWei,
          suggestedGasPriceGwei: stats.suggestedGasPriceGwei,
          source: 'Blockchair',
          updatedAt: blockchairEthResult.updatedAt,
          isStale,
          status: status === 'rate_limited' ? 'unavailable' : status,
        };

        return {
          chain,
          name: CHAIN_DISPLAY_NAMES[chain],
          nativeSymbol: CHAIN_NATIVE_SYMBOLS[chain],
          coinGeckoId: coinId,
          market: marketData,
          network: networkData,
        };
      }

      // Ethereum fallback (when Blockchair unavailable) or BSC/Polygon (unsupported on Blockchair)
      if (
        rpcNetwork.isStale ||
        rpcNetwork.status !== 'available' ||
        marketResult.isStale ||
        marketResult.status !== 'available'
      ) {
        allFresh = false;
      }

      const marketData: CoinMarketData = {
        priceUsd: coinGeckoQuote ? coinGeckoQuote.priceUsd : null,
        change24h: coinGeckoQuote ? coinGeckoQuote.change24h : null,
        source: 'CoinGecko',
        updatedAt: marketResult.updatedAt,
        isStale: marketResult.isStale,
        status: marketResult.status,
      };

      return {
        chain,
        name: CHAIN_DISPLAY_NAMES[chain],
        nativeSymbol: CHAIN_NATIVE_SYMBOLS[chain],
        coinGeckoId: coinId,
        market: marketData,
        network: rpcNetwork,
      };
    });

    return {
      data: items,
      meta: {
        fetchedAt: serverFetchedAt,
        cached: allFresh,
      },
    };
  }

  /**
   * Resolves Blockchair stats for supported chains (Ethereum) with cache-aside,
   * stampede deduplication, and allowable stale window fallback.
   */
  async resolveBlockchairStats(chain: string): Promise<{
    stats: CachedBlockchairStatsEnvelope['data'] | null;
    updatedAt: string | null;
    isStale: boolean;
    status: 'available' | 'stale' | 'rate_limited' | 'unavailable';
  }> {
    if (!isBlockchairSupportedChain(chain)) {
      return {
        stats: null,
        updatedAt: null,
        isStale: false,
        status: 'unavailable',
      };
    }

    const now = Date.now();
    const cacheKey = buildOverviewBlockchairCacheKey(chain);

    // 1. Read cached envelope from Redis
    const cached = await this.cacheService.get<CachedBlockchairStatsEnvelope>(cacheKey);

    if (cached && now < cached.expiresAt) {
      return {
        stats: cached.data,
        updatedAt: cached.fetchedAt,
        isStale: false,
        status: 'available',
      };
    }

    // 2. Cache miss or expired: fetch live with in-flight deduplication
    let promise = this.inFlightBlockchairPromises.get(chain);
    if (!promise) {
      promise = (async () => {
        try {
          const fetchResult = await this.blockchairClient.fetchChainStats(chain);

          if (fetchResult.data) {
            const raw = fetchResult.data;
            const blockDate = raw.best_block_time
              ? new Date(raw.best_block_time.replace(' ', 'T') + 'Z').toISOString()
              : null;
            const latestBlockTimestamp = blockDate
              ? Math.floor(new Date(blockDate).getTime() / 1000)
              : null;

            // Suggested gas fee from Blockchair is already in Gwei
            const normalGweiNum = raw.suggested_transaction_fee_gwei_options?.normal;
            const suggestedGasPriceGwei =
              normalGweiNum !== undefined && normalGweiNum !== null
                ? String(normalGweiNum)
                : null;
            const suggestedGasPriceWei =
              normalGweiNum !== undefined && normalGweiNum !== null
                ? BigInt(Math.round(normalGweiNum * 1e9)).toString()
                : null;

            const fetchedAt = new Date().toISOString();
            const envelope: CachedBlockchairStatsEnvelope = {
              data: {
                priceUsd: raw.market_price_usd ?? null,
                change24h: raw.market_price_usd_change_24h_percentage ?? null,
                latestBlockNumber: raw.best_block_height ?? null,
                latestBlockTimestamp,
                blockDate,
                suggestedGasPriceGwei,
                suggestedGasPriceWei,
              },
              fetchedAt,
              expiresAt: Date.now() + OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS * 1000,
            };

            await this.cacheService.set(
              cacheKey,
              envelope,
              OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS,
            );

            return { envelope, isRateLimited: false };
          }

          return { envelope: null, isRateLimited: fetchResult.isRateLimited };
        } catch (err) {
          this.logger.warn(`Blockchair stats fetch error for ${chain}: ${(err as Error).message}`);
          return { envelope: null, isRateLimited: false };
        } finally {
          this.inFlightBlockchairPromises.delete(chain);
        }
      })();

      this.inFlightBlockchairPromises.set(chain, promise);
    }

    const { envelope, isRateLimited } = await promise;

    if (envelope) {
      return {
        stats: envelope.data,
        updatedAt: envelope.fetchedAt,
        isStale: false,
        status: 'available',
      };
    }

    // 3. Live fetch failed: check if stale cached envelope is still usable
    if (cached) {
      const cachedAgeMs = now - new Date(cached.fetchedAt).getTime();
      if (cachedAgeMs <= OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS * 1000) {
        this.logger.debug(`Serving stale Blockchair stats for ${chain} within allowable window.`);
        return {
          stats: cached.data,
          updatedAt: cached.fetchedAt,
          isStale: true,
          status: 'stale',
        };
      }
    }

    // 4. No cache or stale window exceeded
    return {
      stats: null,
      updatedAt: null,
      isStale: false,
      status: isRateLimited ? 'rate_limited' : 'unavailable',
    };
  }

  /**
   * Resolves market quotes for all coins with cache-aside, stampede protection,
   * and stale fallback on 429/upstream network failures.
   */
  async resolveMarketData(): Promise<{
    quotes: Record<string, { priceUsd: number | null; change24h: number | null }>;
    updatedAt: string | null;
    isStale: boolean;
    status: CoinMarketData['status'];
  }> {
    const now = Date.now();

    // 1. Read cached envelope from Redis
    const cached = await this.cacheService.get<CachedMarketEnvelope>(OVERVIEW_MARKET_CACHE_KEY);

    if (cached && now < cached.expiresAt) {
      return {
        quotes: cached.data,
        updatedAt: cached.fetchedAt,
        isStale: false,
        status: 'available',
      };
    }

    // 2. Cache miss or expired: fetch live with deduplication
    if (!this.inFlightMarketPromise) {
      this.inFlightMarketPromise = (async () => {
        try {
          const coinIds = Object.values(COINGECKO_COIN_IDS);
          const fetchResult = await this.coinGeckoClient.fetchMarketPrices(coinIds);

          if (fetchResult.data) {
            const envelope: CachedMarketEnvelope = {
              data: fetchResult.data,
              fetchedAt: fetchResult.fetchedAt,
              expiresAt: Date.now() + OVERVIEW_MARKET_CACHE_TTL_SECONDS * 1000,
            };

            // Store in Redis for max stale duration
            await this.cacheService.set(
              OVERVIEW_MARKET_CACHE_KEY,
              envelope,
              OVERVIEW_MARKET_MAX_STALE_SECONDS,
            );

            return { envelope, isRateLimited: false };
          }

          return { envelope: null, isRateLimited: fetchResult.isRateLimited };
        } catch (err) {
          this.logger.warn(`Market data fetch error: ${(err as Error).message}`);
          return { envelope: null, isRateLimited: false };
        } finally {
          this.inFlightMarketPromise = null;
        }
      })();
    }

    const { envelope, isRateLimited } = await this.inFlightMarketPromise;

    if (envelope) {
      return {
        quotes: envelope.data,
        updatedAt: envelope.fetchedAt,
        isStale: false,
        status: 'available',
      };
    }

    // 3. Live fetch failed: check if stale cached envelope is still usable
    if (cached) {
      const cachedAgeMs = now - new Date(cached.fetchedAt).getTime();
      if (cachedAgeMs <= OVERVIEW_MARKET_MAX_STALE_SECONDS * 1000) {
        this.logger.debug('Serving stale market data within allowable window.');
        return {
          quotes: cached.data,
          updatedAt: cached.fetchedAt,
          isStale: true,
          status: 'stale',
        };
      }
    }

    // 4. No cache or stale window exceeded
    return {
      quotes: {},
      updatedAt: null,
      isStale: false,
      status: isRateLimited ? 'rate_limited' : 'unavailable',
    };
  }

  /**
   * Resolves network data for a chain with cache-aside, stampede protection,
   * and stale fallback on RPC timeout/failure.
   */
  async resolveNetworkData(chain: OverviewChain): Promise<ChainNetworkData> {
    const now = Date.now();
    const cacheKey = buildOverviewNetworkCacheKey(chain);

    // 1. Read cached envelope from Redis
    const cached = await this.cacheService.get<CachedNetworkEnvelope>(cacheKey);

    if (cached && now < cached.expiresAt) {
      return {
        ...cached.data,
        source: 'EVM RPC',
        updatedAt: cached.fetchedAt,
        isStale: false,
        status: 'available',
      };
    }

    // 2. Cache miss or expired: fetch live with deduplication per chain
    let promise = this.inFlightNetworkPromises.get(chain);
    if (!promise) {
      promise = (async () => {
        try {
          const result = await this.rpcClient.getLatestBlockAndGas(chain);

          if (result.blockNumberHex && result.blockTimestampHex) {
            const blockNumber = Number.parseInt(result.blockNumberHex, 16);
            const blockTimestamp = Number.parseInt(result.blockTimestampHex, 16);
            const blockDate = new Date(blockTimestamp * 1000).toISOString();

            const suggestedGasPriceWei = result.gasPriceHex
              ? BigInt(result.gasPriceHex).toString()
              : null;
            const suggestedGasPriceGwei = formatWeiToGwei(result.gasPriceHex);

            const fetchedAt = new Date().toISOString();
            const envelope: CachedNetworkEnvelope = {
              data: {
                latestBlockNumber: Number.isFinite(blockNumber) ? blockNumber : null,
                latestBlockTimestamp: Number.isFinite(blockTimestamp) ? blockTimestamp : null,
                blockDate,
                suggestedGasPriceWei,
                suggestedGasPriceGwei,
              },
              fetchedAt,
              expiresAt: Date.now() + OVERVIEW_NETWORK_CACHE_TTL_SECONDS * 1000,
            };

            // Store in Redis for max stale duration
            await this.cacheService.set(
              cacheKey,
              envelope,
              OVERVIEW_NETWORK_MAX_STALE_SECONDS,
            );

            return envelope;
          }

          return null;
        } catch (err) {
          this.logger.warn(`Network data fetch error on ${chain}: ${(err as Error).message}`);
          return null;
        } finally {
          this.inFlightNetworkPromises.delete(chain);
        }
      })();

      this.inFlightNetworkPromises.set(chain, promise);
    }

    const envelope = await promise;

    if (envelope) {
      return {
        ...envelope.data,
        source: 'EVM RPC',
        updatedAt: envelope.fetchedAt,
        isStale: false,
        status: 'available',
      };
    }

    // 3. Live fetch failed: check if stale cached envelope is still usable
    if (cached) {
      const cachedAgeMs = now - new Date(cached.fetchedAt).getTime();
      if (cachedAgeMs <= OVERVIEW_NETWORK_MAX_STALE_SECONDS * 1000) {
        this.logger.debug(`Serving stale network data for ${chain} within allowable window.`);
        return {
          ...cached.data,
          source: 'EVM RPC',
          updatedAt: cached.fetchedAt,
          isStale: true,
          status: 'stale',
        };
      }
    }

    // 4. No cache or stale window exceeded
    return this.createUnavailableNetworkData('EVM RPC');
  }

  private createUnavailableNetworkData(source = 'EVM RPC'): ChainNetworkData {
    return {
      latestBlockNumber: null,
      latestBlockTimestamp: null,
      blockDate: null,
      suggestedGasPriceWei: null,
      suggestedGasPriceGwei: null,
      source,
      updatedAt: null,
      isStale: false,
      status: 'unavailable',
    };
  }
}
