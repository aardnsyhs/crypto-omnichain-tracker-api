export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber?: string;
  transactionHash?: string;
  transactionIndex?: string;
  blockHash?: string;
  logIndex: string;
  removed?: boolean;
}

export interface RpcTransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  logs: RpcLog[];
  status?: string; // '0x1' for success, '0x0' for reverted/failed
  effectiveGasPrice?: string;
}

export interface RpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
  blockNumber: string | null;
  blockHash: string | null;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce: string;
}

export interface TokenMetadata {
  contractAddress: string;
  chain: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  isDegraded?: boolean;
  failureReasons?: string[];
}

export interface RpcEnrichmentData {
  receipt: RpcTransactionReceipt | null;
  transaction: RpcTransaction | null;
  inputData: string | null;
  gasUsed: string | null;
  status: 'confirmed' | 'failed' | 'pending' | 'unknown';
  logs: RpcLog[];
  tokenMetadataMap: Map<string, TokenMetadata>;
  temporaryFailure: boolean;
  failureReason?: string;
  toIsContract?: boolean | null;
}
