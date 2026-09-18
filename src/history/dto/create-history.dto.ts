export interface CreateHistoryDto {
  transactionHash: string;
  chain: string;
  outcome:
    'success' | 'not_found' | 'validation_error' | 'upstream_error' | 'rate_limited' | string;
  cacheHit: boolean;
}
