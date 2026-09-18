export interface HistoryItemDto {
  id: string;
  transactionHash: string;
  chain: string;
  outcome: string;
  cacheHit: boolean;
  searchedAt: string;
}

export interface HistoryListResponse {
  data: HistoryItemDto[];
  meta: {
    total: number;
    sessionId: string;
  };
}
