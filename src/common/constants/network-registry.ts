export type NetworkFamily = 'evm' | 'utxo';

export type ActiveChain =
  | 'ethereum'
  | 'bitcoin'
  | 'litecoin'
  | 'dogecoin'
  | 'bitcoin-cash'
  | 'dash';

export type LegacyChain = 'bsc' | 'polygon';

export type SupportedChain = ActiveChain | LegacyChain;

export interface NetworkConfig {
  id: SupportedChain;
  name: string;
  nativeSymbol: string;
  family: NetworkFamily;
  blockchairSlug: string | null;
  decimals: number;
  hashPattern: RegExp;
  hashPlaceholder: string;
  explorerTxUrlTemplate: string;
  feeType: 'gas_price' | 'fee_rate';
  feeUnit: 'Gwei' | 'sat/byte';
  isActive: boolean;
  capabilities: {
    overview: boolean;
    lookup: boolean;
  };
}

export const ACTIVE_CHAINS: readonly ActiveChain[] = [
  'ethereum',
  'bitcoin',
  'litecoin',
  'dogecoin',
  'bitcoin-cash',
  'dash',
] as const;

export const LEGACY_CHAINS: readonly LegacyChain[] = ['bsc', 'polygon'] as const;

export const ALL_SUPPORTED_CHAINS: readonly SupportedChain[] = [
  ...ACTIVE_CHAINS,
  ...LEGACY_CHAINS,
] as const;

export const NETWORK_REGISTRY: Record<SupportedChain, NetworkConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    family: 'evm',
    blockchairSlug: 'ethereum',
    decimals: 18,
    hashPattern: /^0x[0-9a-fA-F]{64}$/,
    hashPlaceholder: '0x followed by 64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://blockchair.com/ethereum/transaction/{hash}',
    feeType: 'gas_price',
    feeUnit: 'Gwei',
    isActive: true,
    capabilities: {
      overview: true,
      lookup: true,
    },
  },
  bitcoin: {
    id: 'bitcoin',
    name: 'Bitcoin',
    nativeSymbol: 'BTC',
    family: 'utxo',
    blockchairSlug: 'bitcoin',
    decimals: 8,
    hashPattern: /^[0-9a-fA-F]{64}$/,
    hashPlaceholder: '64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://blockchair.com/bitcoin/transaction/{hash}',
    feeType: 'fee_rate',
    feeUnit: 'sat/byte',
    isActive: true,
    capabilities: {
      overview: true,
      lookup: true,
    },
  },
  litecoin: {
    id: 'litecoin',
    name: 'Litecoin',
    nativeSymbol: 'LTC',
    family: 'utxo',
    blockchairSlug: 'litecoin',
    decimals: 8,
    hashPattern: /^[0-9a-fA-F]{64}$/,
    hashPlaceholder: '64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://blockchair.com/litecoin/transaction/{hash}',
    feeType: 'fee_rate',
    feeUnit: 'sat/byte',
    isActive: true,
    capabilities: {
      overview: true,
      lookup: true,
    },
  },
  dogecoin: {
    id: 'dogecoin',
    name: 'Dogecoin',
    nativeSymbol: 'DOGE',
    family: 'utxo',
    blockchairSlug: 'dogecoin',
    decimals: 8,
    hashPattern: /^[0-9a-fA-F]{64}$/,
    hashPlaceholder: '64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://blockchair.com/dogecoin/transaction/{hash}',
    feeType: 'fee_rate',
    feeUnit: 'sat/byte',
    isActive: true,
    capabilities: {
      overview: true,
      lookup: true,
    },
  },
  'bitcoin-cash': {
    id: 'bitcoin-cash',
    name: 'Bitcoin Cash',
    nativeSymbol: 'BCH',
    family: 'utxo',
    blockchairSlug: 'bitcoin-cash',
    decimals: 8,
    hashPattern: /^[0-9a-fA-F]{64}$/,
    hashPlaceholder: '64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://blockchair.com/bitcoin-cash/transaction/{hash}',
    feeType: 'fee_rate',
    feeUnit: 'sat/byte',
    isActive: true,
    capabilities: {
      overview: true,
      lookup: true,
    },
  },
  dash: {
    id: 'dash',
    name: 'Dash',
    nativeSymbol: 'DASH',
    family: 'utxo',
    blockchairSlug: 'dash',
    decimals: 8,
    hashPattern: /^[0-9a-fA-F]{64}$/,
    hashPlaceholder: '64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://blockchair.com/dash/transaction/{hash}',
    feeType: 'fee_rate',
    feeUnit: 'sat/byte',
    isActive: true,
    capabilities: {
      overview: true,
      lookup: true,
    },
  },
  // Legacy chains maintained for backwards compatibility
  bsc: {
    id: 'bsc',
    name: 'BNB Smart Chain',
    nativeSymbol: 'BNB',
    family: 'evm',
    blockchairSlug: null,
    decimals: 18,
    hashPattern: /^0x[0-9a-fA-F]{64}$/,
    hashPlaceholder: '0x followed by 64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://bscscan.com/tx/{hash}',
    feeType: 'gas_price',
    feeUnit: 'Gwei',
    isActive: false,
    capabilities: {
      overview: false,
      lookup: true,
    },
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon PoS',
    nativeSymbol: 'POL',
    family: 'evm',
    blockchairSlug: null,
    decimals: 18,
    hashPattern: /^0x[0-9a-fA-F]{64}$/,
    hashPlaceholder: '0x followed by 64 hexadecimal characters',
    explorerTxUrlTemplate: 'https://polygonscan.com/tx/{hash}',
    feeType: 'gas_price',
    feeUnit: 'Gwei',
    isActive: false,
    capabilities: {
      overview: false,
      lookup: true,
    },
  },
};

export function isSupportedChain(chain: string): chain is SupportedChain {
  return chain.toLowerCase() in NETWORK_REGISTRY;
}

export function isActiveChain(chain: string): chain is ActiveChain {
  const norm = chain.toLowerCase();
  return ACTIVE_CHAINS.includes(norm as ActiveChain);
}

export function getNetworkConfig(chain: string): NetworkConfig {
  const config = NETWORK_REGISTRY[chain.toLowerCase() as SupportedChain];
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return config;
}

export function isUtxoChain(chain: string): boolean {
  if (!isSupportedChain(chain)) return false;
  return getNetworkConfig(chain).family === 'utxo';
}

export function isEvmChain(chain: string): boolean {
  if (!isSupportedChain(chain)) return false;
  return getNetworkConfig(chain).family === 'evm';
}

export function isValidHashForChain(chain: string, hash: string): boolean {
  if (!isSupportedChain(chain)) return false;
  const config = getNetworkConfig(chain);
  return config.hashPattern.test(hash.trim());
}

export function getExplorerUrlForChain(chain: string, hash: string): string {
  const config = getNetworkConfig(chain);
  return config.explorerTxUrlTemplate.replace('{hash}', hash);
}
