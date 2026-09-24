export const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
export const COINGECKO_TIMEOUT_MS = 6000;

export const SUPPORTED_OVERVIEW_CHAINS = ['ethereum', 'bsc', 'polygon'] as const;
export type OverviewChain = (typeof SUPPORTED_OVERVIEW_CHAINS)[number];

export const COINGECKO_COIN_IDS: Record<OverviewChain, string> = {
  ethereum: 'ethereum',
  bsc: 'binancecoin',
  polygon: 'polygon-ecosystem-token',
};

export const CHAIN_NATIVE_SYMBOLS: Record<OverviewChain, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
  polygon: 'POL',
};

export const CHAIN_DISPLAY_NAMES: Record<OverviewChain, string> = {
  ethereum: 'Ethereum',
  bsc: 'BNB Smart Chain',
  polygon: 'Polygon PoS',
};
