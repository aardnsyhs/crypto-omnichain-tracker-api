export const DEFAULT_BLOCKCHAIR_BASE_URL = 'https://api.blockchair.com';
export const DEFAULT_BLOCKCHAIR_TIMEOUT_MS = 5000;

/**
 * Maps internal canonical chain enums to Blockchair URL slugs.
 * Official Blockchair v2 documentation only supports Ethereum for EVM dashboards.
 * BSC and Polygon are not supported on api.blockchair.com and use the EVM RPC provider.
 */
export const CHAIN_TO_BLOCKCHAIR_SLUG: Record<string, string> = {
  ethereum: 'ethereum',
  bitcoin: 'bitcoin',
  litecoin: 'litecoin',
  dogecoin: 'dogecoin',
  'bitcoin-cash': 'bitcoin-cash',
  dash: 'dash',
};

export function isBlockchairSupportedChain(chain: string): boolean {
  return Boolean(CHAIN_TO_BLOCKCHAIR_SLUG[chain.toLowerCase()]);
}

export function getBlockchairSlug(chain: string): string {
  const slug = CHAIN_TO_BLOCKCHAIR_SLUG[chain.toLowerCase()];
  if (!slug) {
    throw new Error(`Unsupported chain for Blockchair provider: ${chain}`);
  }
  return slug;
}

export function getBlockchairBaseUrl(): string {
  return process.env.BLOCKCHAIR_BASE_URL || DEFAULT_BLOCKCHAIR_BASE_URL;
}

export function getBlockchairTimeoutMs(): number {
  return Number(process.env.BLOCKCHAIR_TIMEOUT_MS) || DEFAULT_BLOCKCHAIR_TIMEOUT_MS;
}
