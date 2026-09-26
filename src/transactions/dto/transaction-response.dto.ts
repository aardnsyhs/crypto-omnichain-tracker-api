import type {
  ActionStory,
  ApprovalStory,
  CoverageReason,
  StoryCoverage,
  TokenTransferStory,
} from '../story/story.types';
import type { NetworkFamily } from '../../common/constants/network-registry';
import type {
  NormalizedUtxoInput,
  NormalizedUtxoOutput,
} from '../../providers/blockchair/blockchair.interface';

export interface UtxoTransactionDetails {
  version?: number;
  size: number;
  weight?: number;
  vsize?: number;
  isCoinbase: boolean;
  confirmations: number;
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

export interface EnrichedTransactionData {
  transactionHash: string;
  chain: string;
  family: NetworkFamily;
  status: 'confirmed' | 'failed' | 'pending' | 'unknown';
  blockNumber: string;
  timestamp: string | null;
  explorerUrl: string;
  fetchedAt: string;
  explanation: string;
  fee: {
    raw: string;
    formatted: string;
    symbol: string;
  };

  // EVM-specific fields (present when family === 'evm')
  from?: string;
  to?: string | null;
  value?: {
    raw: string;
    formatted: string;
    symbol: string;
  };
  coverage?: StoryCoverage;
  coverageReasons?: CoverageReason[];
  actions?: ActionStory[];
  tokenTransfers?: TokenTransferStory[];
  approvals?: ApprovalStory[];
  technical?: {
    gasUsed?: string | null;
    inputData?: string | null;
  };

  // UTXO-specific fields (present when family === 'utxo')
  utxo?: UtxoTransactionDetails;
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
