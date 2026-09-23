export const EXPECTED_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
};

export const DEFAULT_RPC_TIMEOUT_MS = 8000;
export const TOTAL_ENRICHMENT_DEADLINE_MS = 15000;
export const MAX_METADATA_CONCURRENCY = 3;
export const METADATA_CACHE_MAX_ENTRIES = 500;
export const METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Canonical ERC-20 / ERC-721 Event Topic0 Signatures
export const ERC20_TRANSFER_TOPIC0 =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ERC20_APPROVAL_TOPIC0 =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

// ERC-20 Function Selectors for eth_call
export const SELECTOR_DECIMALS = '0x313ce567';
export const SELECTOR_SYMBOL = '0x95d89b41';
export const SELECTOR_NAME = '0x06fdde03';

// Maximum uint256: 2^256 - 1
export const MAX_UINT256_STRING =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
export const MAX_UINT256_BIGINT =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

/**
 * Resolves configured RPC URL for a supported chain.
 * Prioritizes CHAIN_RPC_URL environment variables.
 */
export function getRpcUrlForChain(chain: string): string | null {
  const normalized = chain.toLowerCase();
  switch (normalized) {
    case 'bsc':
      return process.env.BSC_RPC_URL?.trim() || process.env.RPC_URL_BSC?.trim() || null;
    case 'polygon':
      return process.env.POLYGON_RPC_URL?.trim() || process.env.RPC_URL_POLYGON?.trim() || null;
    case 'ethereum':
    default:
      return process.env.ETHEREUM_RPC_URL?.trim() || process.env.RPC_URL_ETHEREUM?.trim() || null;
  }
}
