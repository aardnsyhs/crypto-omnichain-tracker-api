import type { OverviewChain } from '../providers/coingecko/coingecko.constants';

export type MarketDataStatus = 'available' | 'stale' | 'rate_limited' | 'unavailable';
export type NetworkDataStatus = 'available' | 'stale' | 'unavailable';

export interface CoinMarketData {
  priceUsd: number | null;
  change24h: number | null;
  source: string;
  updatedAt: string | null;
  isStale: boolean;
  status: MarketDataStatus;
}

export interface ChainNetworkData {
  latestBlockNumber: number | null;
  latestBlockTimestamp: number | null;
  blockDate: string | null;
  suggestedGasPriceWei: string | null;
  suggestedGasPriceGwei: string | null;
  source: string;
  updatedAt: string | null;
  isStale: boolean;
  status: NetworkDataStatus;
}

export interface NetworkOverviewItem {
  chain: OverviewChain;
  name: string;
  nativeSymbol: string;
  coinGeckoId: string;
  market: CoinMarketData | null;
  network: ChainNetworkData | null;
}

export interface OverviewResponse {
  data: NetworkOverviewItem[];
  meta: {
    fetchedAt: string;
    cached: boolean;
  };
}

export interface CachedMarketEnvelope {
  data: Record<string, { priceUsd: number | null; change24h: number | null }>;
  fetchedAt: string;
  expiresAt: number;
}

export interface CachedNetworkEnvelope {
  data: {
    latestBlockNumber: number | null;
    latestBlockTimestamp: number | null;
    blockDate: string | null;
    suggestedGasPriceWei: string | null;
    suggestedGasPriceGwei: string | null;
  };
  fetchedAt: string;
  expiresAt: number;
}

export interface CachedBlockchairStatsEnvelope {
  data: {
    priceUsd: number | null;
    change24h: number | null;
    latestBlockNumber: number | null;
    latestBlockTimestamp: number | null;
    blockDate: string | null;
    suggestedGasPriceGwei: string | null;
    suggestedGasPriceWei: string | null;
  };
  fetchedAt: string;
  expiresAt: number;
}
