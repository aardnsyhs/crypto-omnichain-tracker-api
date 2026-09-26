import type { OverviewChain } from './overview.constants';
import type { NetworkFamily } from '../common/constants/network-registry';

export type MarketDataStatus = 'available' | 'stale' | 'rate_limited' | 'unavailable';
export type NetworkDataStatus = 'available' | 'stale' | 'rate_limited' | 'unavailable';

export interface CoinMarketData {
  priceUsd: number | null;
  change24h: number | null;
  source: string;
  updatedAt: string | null;
  isStale: boolean;
  status: MarketDataStatus;
  reason?: string | null;
}

export interface ChainNetworkData {
  latestBlockNumber: number | null;
  latestBlockTimestamp: number | null;
  blockDate: string | null;
  suggestedGasPriceWei?: string | null;
  suggestedGasPriceGwei?: string | null;
  suggestedFeeRate: string | null;
  feeUnit: string;
  source: string;
  updatedAt: string | null;
  isStale: boolean;
  status: NetworkDataStatus;
  reason?: string | null;
  gasNote?: string | null;
  feeRateNote?: string | null;
}

export interface NetworkOverviewItem {
  chain: OverviewChain;
  name: string;
  nativeSymbol: string;
  family: NetworkFamily;
  coinGeckoId?: string;
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

export interface CachedOverviewEnvelope {
  items: NetworkOverviewItem[];
  fetchedAt: string;
  expiresAt: number;
}
