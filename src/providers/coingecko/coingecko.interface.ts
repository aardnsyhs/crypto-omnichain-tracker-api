export interface RawCoinGeckoPriceItem {
  usd?: number;
  usd_24h_change?: number | null;
}

export type RawCoinGeckoSimplePriceResponse = Record<string, RawCoinGeckoPriceItem>;

export interface CoinMarketQuote {
  priceUsd: number | null;
  change24h: number | null;
}

export interface CoinGeckoFetchResult {
  data: Record<string, CoinMarketQuote> | null;
  isRateLimited: boolean;
  error?: string;
  fetchedAt: string;
}
