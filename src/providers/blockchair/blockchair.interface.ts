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

export interface ProviderResult {
  transaction: NormalizedTransaction;
  upstreamStatusCode: number;
  providerDurationMs: number;
}
