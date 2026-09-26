import {
  ACTIVE_CHAINS,
  type ActiveChain,
} from '../common/constants/network-registry';

export const SUPPORTED_OVERVIEW_CHAINS = ACTIVE_CHAINS;
export type OverviewChain = ActiveChain;

export const OVERVIEW_BLOCKCHAIR_CACHE_TTL_SECONDS = 60;
export const OVERVIEW_BLOCKCHAIR_MAX_STALE_SECONDS = 300; // 5 minutes

/**
 * Cache key prefix for Blockchair multichain overview data.
 * Version v4 isolates the new 6-chain Blockchair batch cache.
 */
export const OVERVIEW_BLOCKCHAIR_CACHE_KEY_PREFIX = 'overview:blockchair:v4';

export function buildOverviewBlockchairCacheKey(chain?: string): string {
  if (!chain) {
    return `${OVERVIEW_BLOCKCHAIR_CACHE_KEY_PREFIX}:all`;
  }
  return `${OVERVIEW_BLOCKCHAIR_CACHE_KEY_PREFIX}:${chain.toLowerCase()}`;
}
