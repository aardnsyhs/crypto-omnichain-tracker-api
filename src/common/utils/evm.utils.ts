/**
 * Formats a raw wei value to decimal string using BigInt string operations
 * to prevent floating-point precision loss.
 */
export function formatUnits(rawWei: string | number | bigint, decimals = 18): string {
  const rawStr = rawWei.toString().trim();
  if (!rawStr || rawStr === '0') {
    return '0';
  }

  const isNegative = rawStr.startsWith('-');
  const absStr = isNegative ? rawStr.slice(1) : rawStr;
  const padded = absStr.padStart(decimals + 1, '0');
  const integerPart = padded.slice(0, padded.length - decimals) || '0';
  const fractionalPart = padded.slice(padded.length - decimals).replace(/0+$/, '');

  const formatted = fractionalPart.length > 0 ? `${integerPart}.${fractionalPart}` : integerPart;

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Converts Wei (hex string, decimal string, or bigint) to Gwei using exact 9-decimal string math.
 * Returns null if input is null, undefined, or invalid. Preserves exact '0' for true zero.
 */
export function formatWeiToGwei(
  rawWeiHexOrDec: string | number | bigint | null | undefined,
): string | null {
  if (rawWeiHexOrDec === null || rawWeiHexOrDec === undefined) {
    return null;
  }

  const str =
    typeof rawWeiHexOrDec === 'bigint' ? rawWeiHexOrDec.toString() : String(rawWeiHexOrDec).trim();

  if (!str || str === 'null' || str === 'undefined') {
    return null;
  }

  let decStr: string;
  try {
    decStr = BigInt(str).toString();
  } catch {
    return null;
  }

  return formatUnits(decStr, 9);
}

/**
 * Returns native token symbol for supported EVM chains.
 */
export function getNativeSymbol(chain: string): string {
  switch (chain.toLowerCase()) {
    case 'bsc':
      return 'BNB';
    case 'polygon':
      return 'POL';
    case 'ethereum':
    default:
      return 'ETH';
  }
}

/**
 * Generates direct block explorer URL for confirmed transaction.
 */
export function getExplorerUrl(chain: string, transactionHash: string): string {
  const normalizedHash = transactionHash.toLowerCase();
  switch (chain.toLowerCase()) {
    case 'bsc':
      return `https://bscscan.com/tx/${normalizedHash}`;
    case 'polygon':
      return `https://polygonscan.com/tx/${normalizedHash}`;
    case 'ethereum':
    default:
      return `https://etherscan.io/tx/${normalizedHash}`;
  }
}
