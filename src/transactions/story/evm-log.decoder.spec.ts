import { EvmLogDecoder } from './evm-log.decoder';
import {
  ERC20_APPROVAL_TOPIC0,
  ERC20_TRANSFER_TOPIC0,
  MAX_UINT256_STRING,
} from '../../providers/rpc/evm-rpc.constants';
import type { RpcLog, TokenMetadata } from '../../providers/rpc/evm-rpc.interface';

describe('EvmLogDecoder', () => {
  let decoder: EvmLogDecoder;

  beforeEach(() => {
    decoder = new EvmLogDecoder();
  });

  const padAddress = (addr: string) => `0x000000000000000000000000${addr.slice(2).toLowerCase()}`;
  const padUint256Hex = (hex: string) => `0x${hex.replace(/^0x/, '').padStart(64, '0')}`;

  const fromAddr = '0x1111111111111111111111111111111111111111';
  const toAddr = '0x2222222222222222222222222222222222222222';
  const spenderAddr = '0x3333333333333333333333333333333333333333';
  const tokenContract = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('decodes ERC-20 transfer with 18, 6, 8, and null decimals accurately without floating loss', () => {
    const metadataMap = new Map<string, TokenMetadata>([
      [
        tokenContract,
        {
          contractAddress: tokenContract,
          chain: 'ethereum',
          symbol: 'TEST18',
          name: 'Test 18',
          decimals: 18,
        },
      ],
      [
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        {
          contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          chain: 'ethereum',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
        },
      ],
      [
        '0xcccccccccccccccccccccccccccccccccccccccc',
        {
          contractAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
          chain: 'ethereum',
          symbol: 'WBTC',
          name: 'Wrapped BTC',
          decimals: 8,
        },
      ],
      [
        '0xdddddddddddddddddddddddddddddddddddddddd',
        {
          contractAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
          chain: 'ethereum',
          symbol: 'NODEC',
          name: 'No Decimals',
          decimals: null, // Unknown decimals
        },
      ],
    ]);

    const logs: RpcLog[] = [
      // 1.5 TEST18 (18 decimals: 1500000000000000000 = 0x14d1120d7b160000)
      {
        address: tokenContract,
        topics: [ERC20_TRANSFER_TOPIC0, padAddress(fromAddr), padAddress(toAddr)],
        data: padUint256Hex('14d1120d7b160000'),
        logIndex: '0x0',
      },
      // 50.25 USDC (6 decimals: 50250000 = 0x2fe7010)
      {
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        topics: [ERC20_TRANSFER_TOPIC0, padAddress(fromAddr), padAddress(toAddr)],
        data: padUint256Hex('2fec110'),
        logIndex: '0x1',
      },
      // 1.25 WBTC (8 decimals: 125000000 = 0x7735940)
      {
        address: '0xcccccccccccccccccccccccccccccccccccccccc',
        topics: [ERC20_TRANSFER_TOPIC0, padAddress(fromAddr), padAddress(toAddr)],
        data: padUint256Hex('7735940'),
        logIndex: '0x2',
      },
      // Unknown decimals token: 999999 units
      {
        address: '0xdddddddddddddddddddddddddddddddddddddddd',
        topics: [ERC20_TRANSFER_TOPIC0, padAddress(fromAddr), padAddress(toAddr)],
        data: padUint256Hex('f423f'),
        logIndex: '0x3',
      },
    ];

    const result = decoder.decodeLogs(logs, metadataMap);

    expect(result.tokenTransfers).toHaveLength(4);

    expect(result.tokenTransfers[0].formattedAmount).toBe('1.5');
    expect(result.tokenTransfers[0].symbol).toBe('TEST18');
    expect(result.tokenTransfers[0].rawAmount).toBe('1500000000000000000');

    expect(result.tokenTransfers[1].formattedAmount).toBe('50.25');
    expect(result.tokenTransfers[1].symbol).toBe('USDC');

    expect(result.tokenTransfers[2].formattedAmount).toBe('1.25');
    expect(result.tokenTransfers[2].symbol).toBe('WBTC');

    expect(result.tokenTransfers[3].formattedAmount).toBeNull();
    expect(result.tokenTransfers[3].rawAmount).toBe('999999');
    expect(result.tokenTransfers[3].decimals).toBeNull();
  });

  it('strictly distinguishes ERC-721 Transfer (4 topics) from ERC-20 (3 topics)', () => {
    const logs: RpcLog[] = [
      // ERC-721 NFT Transfer: topic0, from, to, tokenId (4 topics)
      {
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        topics: [
          ERC20_TRANSFER_TOPIC0,
          padAddress(fromAddr),
          padAddress(toAddr),
          padUint256Hex('42'), // tokenId 42
        ],
        data: '0x',
        logIndex: '0x0',
      },
      // Regular ERC-20 Transfer: 3 topics + data
      {
        address: tokenContract,
        topics: [ERC20_TRANSFER_TOPIC0, padAddress(fromAddr), padAddress(toAddr)],
        data: padUint256Hex('de0b6b3a7640000'), // 1.0 (18 decimals)
        logIndex: '0x1',
      },
    ];

    const result = decoder.decodeLogs(logs, new Map());

    expect(result.hasNftEvents).toBe(true);
    expect(result.tokenTransfers).toHaveLength(1);
    expect(result.tokenTransfers[0].tokenAddress).toBe(tokenContract);
  });

  it('decodes ERC-20 Approval with zero revocation and maximum uint256 allowance', () => {
    const logs: RpcLog[] = [
      // Zero approval: Revocation
      {
        address: tokenContract,
        topics: [ERC20_APPROVAL_TOPIC0, padAddress(fromAddr), padAddress(spenderAddr)],
        data: padUint256Hex('0'),
        logIndex: '0x0',
      },
      // Maximum uint256 approval: 2^256 - 1
      {
        address: tokenContract,
        topics: [ERC20_APPROVAL_TOPIC0, padAddress(fromAddr), padAddress(spenderAddr)],
        data: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        logIndex: '0x1',
      },
      // Finite approval: 100 * 10^18
      {
        address: tokenContract,
        topics: [ERC20_APPROVAL_TOPIC0, padAddress(fromAddr), padAddress(spenderAddr)],
        data: padUint256Hex('56bc75e2d63100000'),
        logIndex: '0x2',
      },
    ];

    const metadataMap = new Map<string, TokenMetadata>([
      [
        tokenContract,
        {
          contractAddress: tokenContract,
          chain: 'ethereum',
          symbol: 'DAI',
          name: 'Dai Stablecoin',
          decimals: 18,
        },
      ],
    ]);

    const result = decoder.decodeLogs(logs, metadataMap);

    expect(result.approvals).toHaveLength(3);

    // Revocation
    expect(result.approvals[0].isRevocation).toBe(true);
    expect(result.approvals[0].isUnlimited).toBe(false);
    expect(result.approvals[0].formattedAmount).toBe('0');

    // Unlimited
    expect(result.approvals[1].isRevocation).toBe(false);
    expect(result.approvals[1].isUnlimited).toBe(true);
    expect(result.approvals[1].rawAmount).toBe(MAX_UINT256_STRING);

    // Finite
    expect(result.approvals[2].isRevocation).toBe(false);
    expect(result.approvals[2].isUnlimited).toBe(false);
    expect(result.approvals[2].formattedAmount).toBe('100');
  });
});
