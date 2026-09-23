export const DEFAULT_TRANSACTION_CACHE_TTL_SECONDS = 3600;
export const DEFAULT_TRANSACTION_CACHE_TTL_DEGRADED = 60;
export const DEFAULT_TRANSACTION_CACHE_TTL_PENDING = 0; // 0 strictly means bypass cache

/**
 * Builds canonical Redis cache key for normalized transaction lookups.
 * Specification format: transaction:v2:{chain}:{lowercase_transaction_hash}
 * Note: Incremented to v2 to cleanly isolate Transaction Story payload schemas.
 */
export function buildTransactionCacheKey(chain: string, transactionHash: string): string {
  return `transaction:v2:${chain.toLowerCase()}:${transactionHash.toLowerCase()}`;
}

export function getTransactionCacheTtlSeconds(): number {
  return Number(process.env.TRANSACTION_CACHE_TTL_SECONDS) || DEFAULT_TRANSACTION_CACHE_TTL_SECONDS;
}

export function getDegradedTransactionCacheTtlSeconds(): number {
  return (
    Number(process.env.TRANSACTION_CACHE_TTL_DEGRADED) || DEFAULT_TRANSACTION_CACHE_TTL_DEGRADED
  );
}

export function getPendingTransactionCacheTtlSeconds(): number {
  if (process.env.TRANSACTION_CACHE_TTL_PENDING !== undefined) {
    return Number(process.env.TRANSACTION_CACHE_TTL_PENDING);
  }
  return DEFAULT_TRANSACTION_CACHE_TTL_PENDING;
}

/**
 * Resolves cache TTL in seconds based on execution status and temporary degradation.
 * Returns 0 if caching should be bypassed.
 */
export function resolveTransactionCacheTtl(
  status: 'confirmed' | 'failed' | 'pending' | 'unknown',
  hasTemporaryFailure: boolean,
): number {
  if (status === 'pending') {
    return getPendingTransactionCacheTtlSeconds(); // 0 -> strictly bypass
  }

  if (hasTemporaryFailure || status === 'unknown') {
    return getDegradedTransactionCacheTtlSeconds(); // 60s
  }

  return getTransactionCacheTtlSeconds(); // 3600s
}
