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
  suggested_transaction_fee_per_byte_sat?: number | null;
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

export interface RawBlockchairGlobalStatsResponse {
  data?: Record<string, { data?: RawBlockchairStats } | null> | null;
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

export interface BlockchairGlobalStatsFetchResult {
  data: Record<string, RawBlockchairStats> | null;
  statusCode: number;
  durationMs: number;
  isRateLimited: boolean;
}

export interface ProviderResult {
  transaction: NormalizedTransaction;
  upstreamStatusCode: number;
  providerDurationMs: number;
}

// ---------------------------------------------------------------------------
// UTXO Data Interfaces (Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash)
// ---------------------------------------------------------------------------

export interface RawBlockchairUtxoTx {
  block_id?: number | null;
  id?: number | null;
  hash?: string;
  date?: string | null;
  time?: string | null;
  size?: number | null;
  weight?: number | null;
  version?: number | null;
  lock_time?: number | null;
  is_coinbase?: boolean | null;
  has_witness?: boolean | null;
  input_count?: number | null;
  output_count?: number | null;
  input_total?: number | string | null;
  input_total_usd?: number | null;
  output_total?: number | string | null;
  output_total_usd?: number | null;
  fee?: number | string | null;
  fee_usd?: number | null;
  fee_per_kb?: number | null;
  fee_per_kb_usd?: number | null;
  fee_per_kwu?: number | null;
  cdd_total?: number | null;
  is_rbf?: boolean | null;
}

export interface RawBlockchairUtxoInput {
  block_id?: number | null;
  transaction_id?: number | null;
  index?: number | null;
  transaction_hash?: string | null;
  date?: string | null;
  time?: string | null;
  value?: number | string | null;
  value_usd?: number | null;
  recipient?: string | null;
  type?: string | null;
  script_hex?: string | null;
  is_from_coinbase?: boolean | null;
  is_spent?: boolean | null;
  spending_block_id?: number | null;
  spending_transaction_hash?: string | null;
  spending_index?: number | null;
}

export interface RawBlockchairUtxoOutput {
  block_id?: number | null;
  transaction_id?: number | null;
  index?: number | null;
  transaction_hash?: string | null;
  date?: string | null;
  time?: string | null;
  value?: number | string | null;
  value_usd?: number | null;
  recipient?: string | null;
  type?: string | null;
  script_hex?: string | null;
  is_from_coinbase?: boolean | null;
  is_spent?: boolean | null;
  spending_block_id?: number | null;
  spending_transaction_hash?: string | null;
  spending_index?: number | null;
}

export interface RawBlockchairUtxoDashboardResponse {
  data?: Record<
    string,
    {
      transaction?: RawBlockchairUtxoTx;
      inputs?: RawBlockchairUtxoInput[];
      outputs?: RawBlockchairUtxoOutput[];
    } | null
  > | null;
  context?: {
    code?: number;
    error?: string | null;
    state?: number | null;
    market_price_usd?: number | null;
  } | null;
}

export interface NormalizedUtxoInput {
  index: number;
  transactionHash: string | null;
  outputIndex: number | null;
  value: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  address: string | null;
  type: string | null;
  isCoinbase: boolean;
  scriptHex?: string | null;
}

export interface NormalizedUtxoOutput {
  index: number;
  value: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  address: string | null;
  type: string | null;
  isSpent: boolean | null;
  scriptHex?: string | null;
}

export interface NormalizedUtxoTransaction {
  transactionHash: string;
  chain: string;
  status: 'confirmed' | 'failed' | 'pending' | 'unknown';
  blockNumber: string;
  timestamp: string | null;
  confirmations: number;
  explorerUrl: string;
  fee: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  size: number;
  weight?: number;
  vsize?: number;
  isCoinbase: boolean;
  inputCount: number;
  outputCount: number;
  inputTotal: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  outputTotal: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  feePerByte?: string | null;
  referenceBlockHeight?: number | null;
  inputsTruncated: boolean;
  outputsTruncated: boolean;
  inputs: NormalizedUtxoInput[];
  outputs: NormalizedUtxoOutput[];
}

export interface UtxoProviderResult {
  transaction: NormalizedUtxoTransaction;
  upstreamStatusCode: number;
  providerDurationMs: number;
}
