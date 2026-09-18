export interface RawBlockchairTx {
  block_id: number;
  hash: string;
  time: string;
  sender: string;
  recipient: string | null;
  value: string;
  fee: string;
  has_result?: boolean;
  status?: number | string;
  failed?: boolean;
}

export interface RawBlockchairResponse {
  data?: Record<string, { transaction?: RawBlockchairTx } | null>;
  context?: {
    code?: number;
    error?: string | null;
  };
}

export interface NormalizedTransaction {
  transactionHash: string;
  chain: string;
  status: 'confirmed' | 'failed' | 'pending';
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
  timestamp: string;
  explorerUrl: string;
}

export interface ProviderResult {
  transaction: NormalizedTransaction;
  upstreamStatusCode: number;
  providerDurationMs: number;
}
