export const SUPPORTED_OVERVIEW_CHAINS = ['ethereum', 'bsc', 'polygon'] as const;
export type OverviewChain = (typeof SUPPORTED_OVERVIEW_CHAINS)[number];

export const CHAIN_NATIVE_SYMBOLS: Record<OverviewChain, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
  polygon: 'POL',
};

export const CHAIN_DISPLAY_NAMES: Record<OverviewChain, string> = {
  ethereum: 'Ethereum',
  bsc: 'BNB Smart Chain',
  polygon: 'Polygon PoS',
};

export const OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS = 30;
export const OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS = 300; // 5 minutes

/**
 * Cache key prefix for Blockchair overview data.
 * Version v3 cleanly isolates and invalidates previous cache entries from CoinGecko/RPC.
 */
export const OVERVIEW_BLOCKCHAIR_CACHE_KEY_PREFIX = 'overview:blockchair:v3';

export function buildOverviewBlockchairCacheKey(chain: string): string {
  return `${OVERVIEW_BLOCKCHAIR_CACHE_KEY_PREFIX}:${chain.toLowerCase()}`;
}
