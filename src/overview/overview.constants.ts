export const OVERVIEW_MARKET_CACHE_TTL_SECONDS = 60;
export const OVERVIEW_MARKET_MAX_STALE_SECONDS = 600; // 10 minutes

export const OVERVIEW_NETWORK_CACHE_TTL_SECONDS = 30;
export const OVERVIEW_NETWORK_MAX_STALE_SECONDS = 300; // 5 minutes

export const OVERVIEW_MARKET_CACHE_KEY = 'overview:market:v1';
export const OVERVIEW_NETWORK_CACHE_KEY_PREFIX = 'overview:network:v1';

export const OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS = 30;
export const OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS = 300; // 5 minutes
export const OVERVIEW_BLOCKCHAIR_CACHE_KEY_PREFIX = 'overview:blockchair:v1';

export function buildOverviewNetworkCacheKey(chain: string): string {
  return `${OVERVIEW_NETWORK_CACHE_KEY_PREFIX}:${chain.toLowerCase()}`;
}

export function buildOverviewBlockchairCacheKey(chain: string): string {
  return `${OVERVIEW_BLOCKCHAIR_CACHE_KEY_PREFIX}:${chain.toLowerCase()}`;
}
