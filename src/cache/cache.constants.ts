export const DEFAULT_TRANSACTION_CACHE_TTL_SECONDS = 3600;

/**
 * Builds canonical Redis cache key for normalized transaction lookups.
 * Specification format: transaction:v1:{chain}:{lowercase_transaction_hash}
 */
export function buildTransactionCacheKey(chain: string, transactionHash: string): string {
  return `transaction:v1:${chain.toLowerCase()}:${transactionHash.toLowerCase()}`;
}

export function getTransactionCacheTtlSeconds(): number {
  return Number(process.env.TRANSACTION_CACHE_TTL_SECONDS) || DEFAULT_TRANSACTION_CACHE_TTL_SECONDS;
}
