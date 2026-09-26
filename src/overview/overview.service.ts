import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { getBlockchairSlug } from '../providers/blockchair/blockchair.constants';
import {
  ACTIVE_CHAINS,
  NETWORK_REGISTRY,
} from '../common/constants/network-registry';
import {
  OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS,
  OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS,
  buildOverviewBlockchairCacheKey,
} from './overview.constants';
import type {
  CachedOverviewEnvelope,
  ChainNetworkData,
  CoinMarketData,
  NetworkOverviewItem,
  OverviewResponse,
} from './overview.interface';
import type { RawBlockchairStats } from '../providers/blockchair/blockchair.interface';

@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  // In-flight request deduplication promise to prevent cache stampedes
  private inFlightBatchPromise: Promise<{
    envelope: CachedOverviewEnvelope | null;
    isRateLimited: boolean;
  }> | null = null;

  constructor(
    private readonly cacheService: CacheService,
    private readonly blockchairClient: BlockchairClient,
  ) {}

  /**
   * Retrieves the combined multichain market and network overview strictly from Blockchair.
   * Batches active chains via GET /stats, with individual fallback resilience.
   * Covers: Ethereum, Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, and Dash.
   */
  async getOverview(): Promise<OverviewResponse> {
    const serverFetchedAt = new Date().toISOString();
    const cacheKey = buildOverviewBlockchairCacheKey();
    const now = Date.now();

    // 1. Read cached envelope from Redis
    const cached = await this.cacheService.get<CachedOverviewEnvelope>(cacheKey);

    if (cached && now < cached.expiresAt && cached.items?.length === ACTIVE_CHAINS.length) {
      return {
        data: cached.items,
        meta: {
          fetchedAt: cached.fetchedAt,
          cached: true,
        },
      };
    }

    // 2. Cache miss or expired: fetch live with deduplication
    if (!this.inFlightBatchPromise) {
      this.inFlightBatchPromise = (async () => {
        try {
          const batchResult = await this.blockchairClient.fetchGlobalStats();
          const globalData = batchResult.data;

          const items: NetworkOverviewItem[] = [];
          const fetchedAt = new Date().toISOString();

          for (const chain of ACTIVE_CHAINS) {
            const config = NETWORK_REGISTRY[chain];
            const slug = getBlockchairSlug(chain);
            let rawStats: RawBlockchairStats | null = globalData ? globalData[slug] ?? null : null;

            // Fallback: If chain was not present in global stats, fetch individually
            if (!rawStats) {
              const indResult = await this.blockchairClient.fetchChainStats(chain);
              rawStats = indResult?.data ?? null;
            }

            if (rawStats) {
              const blockDate = rawStats.best_block_time
                ? new Date(rawStats.best_block_time.replace(' ', 'T') + 'Z').toISOString()
                : null;
              const latestBlockTimestamp = blockDate
                ? Math.floor(new Date(blockDate).getTime() / 1000)
                : null;

              let suggestedFeeRate: string | null = null;
              let suggestedGasPriceGwei: string | null = null;
              let suggestedGasPriceWei: string | null = null;
              let feeRateNote: string | null = null;

              if (config.family === 'evm') {
                const normalGweiNum = rawStats.suggested_transaction_fee_gwei_options?.normal;
                if (normalGweiNum !== undefined && normalGweiNum !== null) {
                  suggestedFeeRate = String(normalGweiNum);
                  suggestedGasPriceGwei = String(normalGweiNum);
                  suggestedGasPriceWei = BigInt(Math.round(normalGweiNum * 1e9)).toString();
                  if (normalGweiNum === 0) {
                    feeRateNote = 'Provider estimated 0 Gwei under low congestion';
                  }
                }
              } else {
                // UTXO chains: Blockchair returns suggested_transaction_fee_per_byte_sat (sat/byte)
                const satPerByte = rawStats.suggested_transaction_fee_per_byte_sat;
                if (satPerByte !== undefined && satPerByte !== null) {
                  suggestedFeeRate = String(satPerByte);
                }
              }

              const market: CoinMarketData = {
                priceUsd: rawStats.market_price_usd ?? null,
                change24h: rawStats.market_price_usd_change_24h_percentage ?? null,
                source: 'Blockchair',
                updatedAt: fetchedAt,
                isStale: false,
                status: 'available',
                reason: null,
              };

              const network: ChainNetworkData = {
                latestBlockNumber: rawStats.best_block_height ?? null,
                latestBlockTimestamp,
                blockDate,
                suggestedGasPriceWei,
                suggestedGasPriceGwei,
                suggestedFeeRate,
                feeUnit: config.feeUnit,
                gasNote: feeRateNote,
                feeRateNote,
                source: 'Blockchair',
                updatedAt: fetchedAt,
                isStale: false,
                status: 'available',
                reason: null,
              };

              items.push({
                chain,
                name: config.name,
                nativeSymbol: config.nativeSymbol,
                family: config.family,
                market,
                network,
              });
            } else {
              // Upstream data unavailable for this chain
              items.push({
                chain,
                name: config.name,
                nativeSymbol: config.nativeSymbol,
                family: config.family,
                market: {
                  priceUsd: null,
                  change24h: null,
                  source: 'Blockchair',
                  updatedAt: null,
                  isStale: false,
                  status: 'unavailable',
                  reason: 'Stats temporarily unavailable from Blockchair',
                },
                network: {
                  latestBlockNumber: null,
                  latestBlockTimestamp: null,
                  blockDate: null,
                  suggestedFeeRate: null,
                  feeUnit: config.feeUnit,
                  source: 'Blockchair',
                  updatedAt: null,
                  isStale: false,
                  status: 'unavailable',
                  reason: 'Node status temporarily unavailable from Blockchair',
                },
              });
            }
          }

          const envelope: CachedOverviewEnvelope = {
            items,
            fetchedAt,
            expiresAt: Date.now() + OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS * 1000,
          };

          await this.cacheService.set(cacheKey, envelope, OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS);

          return { envelope, isRateLimited: false };
        } catch (err) {
          this.logger.warn(`Overview batch fetch failed: ${(err as Error).message}`);
          return { envelope: null, isRateLimited: false };
        } finally {
          this.inFlightBatchPromise = null;
        }
      })();
    }

    const { envelope, isRateLimited } = await this.inFlightBatchPromise;

    if (envelope) {
      return {
        data: envelope.items,
        meta: {
          fetchedAt: envelope.fetchedAt,
          cached: false,
        },
      };
    }

    // 3. Live fetch failed: check if stale cached envelope is still usable within max stale window
    if (cached) {
      const cachedAgeMs = now - new Date(cached.fetchedAt).getTime();
      if (cachedAgeMs <= OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS * 1000) {
        this.logger.debug('Serving stale multichain overview within allowable window.');
        const staleItems = cached.items.map((it) => ({
          ...it,
          market: it.market ? { ...it.market, isStale: true, status: 'stale' as const } : null,
          network: it.network ? { ...it.network, isStale: true, status: 'stale' as const } : null,
        }));

        return {
          data: staleItems,
          meta: {
            fetchedAt: cached.fetchedAt,
            cached: true,
          },
        };
      }
    }

    // 4. Catastrophic fallback: generate empty items with error reason
    const fallbackItems: NetworkOverviewItem[] = ACTIVE_CHAINS.map((chain) => {
      const config = NETWORK_REGISTRY[chain];
      const reason = isRateLimited
        ? 'Blockchair API rate limit reached (HTTP 429)'
        : 'Blockchair stats service temporarily unavailable';

      return {
        chain,
        name: config.name,
        nativeSymbol: config.nativeSymbol,
        family: config.family,
        market: {
          priceUsd: null,
          change24h: null,
          source: 'Blockchair',
          updatedAt: null,
          isStale: false,
          status: isRateLimited ? 'rate_limited' : 'unavailable',
          reason,
        },
        network: {
          latestBlockNumber: null,
          latestBlockTimestamp: null,
          blockDate: null,
          suggestedFeeRate: null,
          feeUnit: config.feeUnit,
          source: 'Blockchair',
          updatedAt: null,
          isStale: false,
          status: isRateLimited ? 'rate_limited' : 'unavailable',
          reason,
        },
      };
    });

    return {
      data: fallbackItems,
      meta: {
        fetchedAt: serverFetchedAt,
        cached: false,
      },
    };
  }
}
