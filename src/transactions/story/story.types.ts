export type StoryCoverage = 'complete' | 'partial' | 'unsupported';

export type CoverageReason =
  | 'metadata_unavailable'
  | 'receipt_unavailable'
  | 'unsupported_call'
  | 'trace_not_available'
  | 'temporary_enrichment_failure'
  | 'provider_discrepancy';

export interface ActionStory {
  type: 'native_transfer' | 'token_transfer' | 'token_approval' | 'contract_interaction';
  description: string;
  actor: string;
  recipient?: string | null;
  asset?: {
    type: 'native' | 'erc20';
    symbol: string | null;
    contractAddress: string | null;
    rawAmount: string;
    formattedAmount: string | null;
    decimals: number | null;
  };
  proof: {
    source: 'native_value' | 'receipt_log' | 'calldata_input';
    contractAddress?: string | null;
    logIndex?: number | string | null;
  };
}

export interface TokenTransferStory {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  from: string;
  to: string;
  rawAmount: string;
  formattedAmount: string | null;
  logIndex: string | number;
}

export interface ApprovalStory {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  owner: string;
  spender: string;
  rawAmount: string;
  formattedAmount: string | null;
  isUnlimited: boolean;
  isRevocation: boolean;
  logIndex: string | number;
}

export interface TransactionStoryResult {
  explanation: string;
  coverage: StoryCoverage;
  coverageReasons: CoverageReason[];
  actions: ActionStory[];
  tokenTransfers: TokenTransferStory[];
  approvals: ApprovalStory[];
}
