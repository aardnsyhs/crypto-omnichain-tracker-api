import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { getBlockchairSlug } from '../providers/blockchair/blockchair.constants';
import { ACTIVE_CHAINS, NETWORK_REGISTRY } from '../common/constants/network-registry';
import {
  OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS,
  OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS,
  buildOverviewBlockchairCacheKey,
} from './overview.constants';
import type {
  CachedOverviewEnvelope,
  NetworkOverviewItem,
  OverviewResponse,
  CoinMarketData,
  ChainNetworkData,
} from './overview.interface';
import type {
  RawBlockchairStats,
  BlockchairGlobalStatsFetchResult,
} from '../providers/blockchair/blockchair.interface';

type Section = CoinMarketData | ChainNetworkData;
const marketKeys = ['priceUsd', 'change24h'] as const;
const networkKeys = [
  'latestBlockNumber',
  'latestBlockTimestamp',
  'blockDate',
  'suggestedFeeRate',
  'suggestedGasPriceGwei',
  'suggestedGasPriceWei',
] as const;

@Injectable()
export class OverviewService {
  private inFlight: Promise<OverviewResponse> | null = null;
  private lastValid: CachedOverviewEnvelope | null = null;
  private retryAt = 0;
  private limited = false;
  private providerStatus: number | undefined;
  constructor(
    private readonly cacheService: CacheService,
    private readonly blockchairClient: BlockchairClient,
  ) {}

  async getOverview(): Promise<OverviewResponse> {
    const cached =
      (await this.cacheService.get<CachedOverviewEnvelope>(buildOverviewBlockchairCacheKey())) ??
      this.lastValid;
    if (cached && Date.now() < cached.expiresAt) return this.present(cached, true);
    if (this.inFlight) return this.inFlight;
    if (Date.now() < this.retryAt) return this.present(cached, true);
    this.inFlight = this.refresh(cached).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async refresh(cached: CachedOverviewEnvelope | null): Promise<OverviewResponse> {
    let batch: BlockchairGlobalStatsFetchResult;
    try {
      batch = await this.blockchairClient.fetchGlobalStats();
    } catch {
      batch = { data: null, isRateLimited: false, statusCode: 502, durationMs: 0 };
    }
    this.limited = batch.isRateLimited || [402, 429].includes(batch.statusCode);
    this.providerStatus = batch.statusCode;
    const now = new Date().toISOString();
    const items: NetworkOverviewItem[] = [];
    let received = false;
    for (const chain of ACTIVE_CHAINS) {
      let raw = batch.data?.[getBlockchairSlug(chain)] ?? null;
      // Only fill holes in a successful batch; an outage must not fan out into six requests.
      if (!raw && batch.data && !this.limited) {
        try {
          const fallback = await this.blockchairClient.fetchChainStats(chain);
          raw = fallback.data;
          this.limited ||= fallback.isRateLimited || [402, 429].includes(fallback.statusCode);
          if (this.limited) this.providerStatus = fallback.statusCode;
        } catch {
          /* Other networks remain usable when one fallback fails. */
        }
      }
      const fresh = this.item(chain, raw, now);
      received ||= [
        ...marketKeys.map((k) => fresh.market?.[k]),
        ...networkKeys.map((k) => fresh.network?.[k]),
      ].some((v) => v != null);
      const previous = cached?.items.find((item) => item.chain === chain);
      fresh.market = this.merge(fresh.market!, previous?.market, marketKeys, now);
      fresh.network = this.merge(fresh.network!, previous?.network, networkKeys, now);
      items.push(fresh);
    }
    this.retryAt = Date.now() + (this.limited ? 60000 : 15000);
    if (!received) return this.present(cached, Boolean(cached));
    const timestamps = items
      .flatMap((item) => [item.market?.updatedAt, item.network?.updatedAt])
      .filter((v): v is string => !!v);
    const envelope: CachedOverviewEnvelope = {
      items,
      fetchedAt: timestamps.sort()[0] ?? now,
      expiresAt: Date.now() + OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS * 1000,
    };
    this.lastValid = envelope;
    await this.cacheService.set(
      buildOverviewBlockchairCacheKey(),
      envelope,
      OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS,
    );
    return this.present(envelope, false);
  }

  private merge<T extends Section>(
    fresh: T,
    previous: T | null | undefined,
    keys: readonly string[],
    now: string,
  ): T {
    fresh = { ...fresh };
    const values = fresh as unknown as Record<string, unknown>;
    const old = previous as unknown as Record<string, unknown> | undefined;
    const fieldUpdatedAt: Record<string, string> = {};
    const staleFields: string[] = [];
    for (const key of keys) {
      let stamp = fresh.fieldUpdatedAt?.[key] ?? (values[key] != null ? fresh.updatedAt : null);
      if (values[key] == null && old?.[key] != null) {
        stamp = previous?.fieldUpdatedAt?.[key] ?? previous?.updatedAt ?? null;
        if (
          stamp &&
          Date.parse(now) - Date.parse(stamp) <= OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS * 1000
        ) {
          values[key] = old[key];
          staleFields.push(key);
        }
      }
      if (values[key] != null && stamp) {
        const age = Date.parse(now) - Date.parse(stamp);
        if (!Number.isFinite(age) || age > OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS * 1000)
          values[key] = null;
        else {
          fieldUpdatedAt[key] = stamp;
          if (
            (age >= OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS * 1000 ||
              fresh.staleFields?.includes(key)) &&
            !staleFields.includes(key)
          )
            staleFields.push(key);
        }
      }
    }
    const stamps = Object.values(fieldUpdatedAt).sort();
    const isStale = staleFields.length > 0;
    return {
      ...fresh,
      fieldUpdatedAt,
      staleFields,
      updatedAt: stamps[0] ?? null,
      isStale,
      status: stamps.length
        ? isStale
          ? 'stale'
          : 'available'
        : this.limited
          ? 'rate_limited'
          : 'unavailable',
      reason: isStale
        ? 'Refresh incomplete; showing preserved values with original timestamps.'
        : !stamps.length
          ? this.limited
            ? 'Blockchair quota or rate limit reached.'
            : 'Blockchair stats temporarily unavailable.'
          : null,
    };
  }

  private present(cached: CachedOverviewEnvelope | null, cacheHit: boolean): OverviewResponse {
    const now = new Date().toISOString();
    const data = ACTIVE_CHAINS.map((chain) => {
      const item =
        cached?.items.find((value) => value.chain === chain) ?? this.item(chain, null, now);
      return {
        ...item,
        market: this.merge(
          item.market ?? this.item(chain, null, now).market!,
          null,
          marketKeys,
          now,
        ),
        network: this.merge(
          item.network ?? this.item(chain, null, now).network!,
          null,
          networkKeys,
          now,
        ),
      };
    });
    return {
      data,
      meta: {
        fetchedAt: cached?.fetchedAt ?? now,
        cached: cacheHit,
        isRateLimited: this.limited,
        providerStatus: this.providerStatus,
      },
    };
  }

  private item(
    chain: (typeof ACTIVE_CHAINS)[number],
    raw: RawBlockchairStats | null,
    now: string,
  ): NetworkOverviewItem {
    const config = NETWORK_REGISTRY[chain];
    const number = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const fee = number(
      config.family === 'evm'
        ? raw?.suggested_transaction_fee_gwei_options?.normal
        : raw?.suggested_transaction_fee_per_byte_sat,
    );
    const parsed = raw?.best_block_time
      ? Date.parse(raw.best_block_time.replace(' ', 'T').replace(/Z?$/, 'Z'))
      : NaN;
    const blockDate = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    const base = {
      source: 'Blockchair',
      updatedAt: raw ? now : null,
      isStale: false,
      status: 'available' as const,
    };
    return {
      chain,
      name: config.name,
      nativeSymbol: config.nativeSymbol,
      family: config.family,
      market: {
        ...base,
        priceUsd: number(raw?.market_price_usd),
        change24h: number(raw?.market_price_usd_change_24h_percentage),
      },
      network: {
        ...base,
        latestBlockNumber: number(raw?.best_block_height),
        blockDate,
        latestBlockTimestamp: blockDate ? Math.floor(parsed / 1000) : null,
        suggestedFeeRate: fee === null ? null : String(fee),
        feeUnit: config.feeUnit,
        suggestedGasPriceGwei: config.family === 'evm' && fee !== null ? String(fee) : null,
        suggestedGasPriceWei:
          config.family === 'evm' && fee !== null ? BigInt(Math.round(fee * 1e9)).toString() : null,
        feeRateNote:
          config.family === 'evm' && fee === 0
            ? 'Provider estimated 0 Gwei under low congestion'
            : null,
      },
    };
  }
}
