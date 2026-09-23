import type {
  ActionStory,
  ApprovalStory,
  CoverageReason,
  StoryCoverage,
  TokenTransferStory,
} from '../story/story.types';

export interface EnrichedTransactionData {
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
  fetchedAt: string;
  explanation: string;
  coverage: StoryCoverage;
  coverageReasons: CoverageReason[];
  actions: ActionStory[];
  tokenTransfers: TokenTransferStory[];
  approvals: ApprovalStory[];
  technical?: {
    gasUsed?: string | null;
    inputData?: string | null;
  };
}

export interface TransactionLookupResponse {
  data: EnrichedTransactionData;
  meta: {
    requestId: string;
    cache: {
      hit: boolean;
    };
  };
}
