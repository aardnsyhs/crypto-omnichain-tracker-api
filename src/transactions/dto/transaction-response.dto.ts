import type { NormalizedTransaction } from '../../providers/blockchair/blockchair.interface';

export interface TransactionLookupResponse {
  data: NormalizedTransaction;
  meta: {
    requestId: string;
    cache: {
      hit: boolean;
    };
  };
}
