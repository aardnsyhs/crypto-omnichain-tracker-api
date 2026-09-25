import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { isBlockchairSupportedChain } from '../providers/blockchair/blockchair.constants';
import {
  CHAIN_DISPLAY_NAMES,
  CHAIN_NATIVE_SYMBOLS,
  SUPPORTED_OVERVIEW_CHAINS,
  OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS,
  OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS,
  buildOverviewBlockchairCacheKey,
} from './overview.constants';
import type {
  CachedBlockchairStatsEnvelope,
  ChainNetworkData,
  CoinMarketData,
  NetworkOverviewItem,
  OverviewResponse,
} from './overview.interface';

@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  // In-flight request deduplication map to prevent cache stampedes
  private inFlightBlockchairPromises = new Map<
    string,
    Promise<{
      envelope: CachedBlockchairStatsEnvelope | null;
      isRateLimited: boolean;
    }>
  >();

  constructor(
    private readonly cacheService: CacheService,
    private readonly blockchairClient: BlockchairClient,
  ) {}

  /**
   * Retrieves the combined market and network overview strictly from Blockchair.
   * CoinGecko and EVM RPC fallback have been removed per source boundary policy:
   * 1. Ethereum: Uses official Blockchair stats (/ethereum/stats) as the exclusive source
   *    for market price, 24h change, best block height, block time, and suggested fee.
   * 2. BSC & Polygon: Preserves network rows with explicit "unavailable" status and reason,
   *    as verified by the official Blockchair /stats API catalog where BSC and Polygon are unindexed.
   */
  async getOverview(): Promise<OverviewResponse> {
    const serverFetchedAt = new Date().toISOString();

    // Fetch Blockchair stats for Ethereum
    const blockchairEthResult = await this.resolveBlockchairStats('ethereum');

    let allFresh = true;

    const items: NetworkOverviewItem[] = SUPPORTED_OVERVIEW_CHAINS.map((chain) => {
      // 1. Ethereum: Uses official Blockchair data
      if (chain === 'ethereum') {
        if (blockchairEthResult.stats !== null) {
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
            gasNote: stats.gasNote ?? null,
            source: 'Blockchair',
            updatedAt: blockchairEthResult.updatedAt,
            isStale,
            status,
          };

          return {
            chain,
            name: CHAIN_DISPLAY_NAMES[chain],
            nativeSymbol: CHAIN_NATIVE_SYMBOLS[chain],
            market: marketData,
            network: networkData,
          };
        }

        // Ethereum unavailable / rate-limited on Blockchair
        allFresh = false;
        const status = blockchairEthResult.status;
        const reason =
          status === 'rate_limited'
            ? 'Blockchair API rate limit reached (HTTP 429)'
            : 'Blockchair stats service temporarily unavailable';

        const marketData: CoinMarketData = {
          priceUsd: null,
          change24h: null,
          source: 'Blockchair',
          updatedAt: null,
          isStale: false,
          status,
          reason,
        };

        const networkData: ChainNetworkData = {
          latestBlockNumber: null,
          latestBlockTimestamp: null,
          blockDate: null,
          suggestedGasPriceWei: null,
          suggestedGasPriceGwei: null,
          gasNote: null,
          source: 'Blockchair',
          updatedAt: null,
          isStale: false,
          status,
          reason,
        };

        return {
          chain,
          name: CHAIN_DISPLAY_NAMES[chain],
          nativeSymbol: CHAIN_NATIVE_SYMBOLS[chain],
          market: marketData,
          network: networkData,
        };
      }

      // 2. BSC and Polygon: Maintained in overview but marked Unavailable per Blockchair API catalog evidence
      const unindexedReason = 'Not indexed in Blockchair stats API catalog';

      const marketData: CoinMarketData = {
        priceUsd: null,
        change24h: null,
        source: 'Blockchair',
        updatedAt: null,
        isStale: false,
        status: 'unavailable',
        reason: unindexedReason,
      };

      const networkData: ChainNetworkData = {
        latestBlockNumber: null,
        latestBlockTimestamp: null,
        blockDate: null,
        suggestedGasPriceWei: null,
        suggestedGasPriceGwei: null,
        gasNote: null,
        source: 'Blockchair',
        updatedAt: null,
        isStale: false,
        status: 'unavailable',
        reason: unindexedReason,
      };

      return {
        chain,
        name: CHAIN_DISPLAY_NAMES[chain],
        nativeSymbol: CHAIN_NATIVE_SYMBOLS[chain],
        market: marketData,
        network: networkData,
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

            // Suggested gas fee from Blockchair is in Gwei
            // Validate: check explicitly for null/undefined vs 0 to avoid converting null to 0
            const normalGweiNum = raw.suggested_transaction_fee_gwei_options?.normal;
            let suggestedGasPriceGwei: string | null = null;
            let suggestedGasPriceWei: string | null = null;
            let gasNote: string | null = null;

            if (normalGweiNum !== undefined && normalGweiNum !== null) {
              suggestedGasPriceGwei = String(normalGweiNum);
              suggestedGasPriceWei = BigInt(Math.round(normalGweiNum * 1e9)).toString();
              if (normalGweiNum === 0) {
                gasNote = 'Provider estimated 0 Gwei under low congestion';
              }
            }

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
                gasNote,
              },
              fetchedAt,
              expiresAt: Date.now() + OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS * 1000,
            };

            await this.cacheService.set(cacheKey, envelope, OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS);

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
}
