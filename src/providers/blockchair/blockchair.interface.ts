export interface RawBlockchairTx {
  block_id?: number | null;
  hash?: string;
  time?: string | null;
  sender?: string;
  recipient?: string | null;
  value?: string | number;
  fee?: string | number;
  has_result?: boolean;
  status?: number | string;
  failed?: boolean;
  input_hex?: string | null;
}

export interface RawBlockchairResponse {
  data?: Record<string, { transaction?: RawBlockchairTx } | null> | null;
  context?: {
    code?: number;
    error?: string | null;
  } | null;
}

export interface NormalizedTransaction {
  transactionHash: string;
  chain: string;
  status: 'confirmed' | 'failed' | 'pending' | 'unknown';
  from: string;
  to: string | null;
  value: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  fee: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  blockNumber: string;
  timestamp: string | null;
  explorerUrl: string;
}

export interface RawBlockchairStats {
  best_block_height?: number | null;
  best_block_time?: string | null;
  market_price_usd?: number | null;
  market_price_usd_change_24h_percentage?: number | null;
  suggested_transaction_fee_gwei_options?: {
    sloth?: number;
    slow?: number;
    normal?: number;
    fast?: number;
    cheetah?: number;
  } | null;
}

export interface RawBlockchairStatsResponse {
  data?: RawBlockchairStats | null;
  context?: {
    code?: number;
    error?: string | null;
  } | null;
}

export interface BlockchairStatsFetchResult {
  data: RawBlockchairStats | null;
  statusCode: number;
  durationMs: number;
  isRateLimited: boolean;
}

export interface ProviderResult {
  transaction: NormalizedTransaction;
  upstreamStatusCode: number;
  providerDurationMs: number;
}
