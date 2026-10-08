import { jest } from '@jest/globals';
import { EvmRpcService } from './evm-rpc.service';
import { type EvmRpcClient, rpcDeadline } from './evm-rpc.client';
import { TokenMetadataCache } from './token-metadata.cache';

describe('EvmRpcService', () => {
  let service: EvmRpcService;
  let mockClient: {
    getTransactionReceipt: jest.Mock;
    getTransactionByHash: jest.Mock;
    fetchTokenMetadata: jest.Mock;
    getCode: jest.Mock;
  };
  let metadataCache: TokenMetadataCache;

  beforeEach(() => {
    mockClient = {
      getTransactionReceipt: jest.fn(),
      getTransactionByHash: jest.fn(),
      fetchTokenMetadata: jest.fn(),
      getCode: jest.fn().mockResolvedValue('0x' as never),
    };
    metadataCache = new TokenMetadataCache();
    service = new EvmRpcService(mockClient as unknown as EvmRpcClient, metadataCache);
  });

  it('maps receipt status 0x1 to confirmed and extracts logs', async () => {
    mockClient.getTransactionReceipt.mockResolvedValue({
      status: '0x1',
      gasUsed: '0x5208', // 21000
      logs: [],
    } as never);

    mockClient.getTransactionByHash.mockResolvedValue({
      input: '0x',
    } as never);

    const result = await service.enrichTransaction(
      'ethereum',
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );

    expect(result.status).toBe('confirmed');
    expect(result.gasUsed).toBe('21000');
    expect(result.temporaryFailure).toBe(false);
  });

  it('maps receipt status 0x0 to failed', async () => {
    mockClient.getTransactionReceipt.mockResolvedValue({
      status: '0x0',
      gasUsed: '0x5208',
      logs: [],
    } as never);

    mockClient.getTransactionByHash.mockResolvedValue(null as never);

    const result = await service.enrichTransaction(
      'ethereum',
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );

    expect(result.status).toBe('failed');
    expect(result.temporaryFailure).toBe(false);
  });

  it('handles client timeout or errors gracefully with temporaryFailure flag', async () => {
    mockClient.getTransactionReceipt.mockRejectedValue(
      new Error('Network connection timeout') as never,
    );
    mockClient.getTransactionByHash.mockRejectedValue(
      new Error('Network connection timeout') as never,
    );

    const result = await service.enrichTransaction(
      'ethereum',
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );

    expect(result.status).toBe('unknown');
    expect(result.temporaryFailure).toBe(true); // Degrades gracefully on timeout/error
  });
});

describe('RPC deadline preservation', () => {
  afterEach(() => jest.useRealTimers());
  it('retains a receipt and transaction when later code enrichment exceeds the deadline', async () => {
    jest.useFakeTimers();
    const receipt = { status: '0x1', gasUsed: '0x5208', logs: [], to: '0xabc' };
    const tx = { input: '0x', to: '0xabc' };
    let signal: AbortSignal | undefined;
    const client = {
      getTransactionReceipt: jest.fn().mockResolvedValue(receipt as never),
      getTransactionByHash: jest.fn().mockResolvedValue(tx as never),
      getCode: jest.fn().mockImplementation(() => {
        signal = rpcDeadline.getStore();
        return new Promise(() => {});
      }),
    };
    const service = new EvmRpcService(client as unknown as EvmRpcClient, new TokenMetadataCache());
    const pending = service.enrichTransaction('ethereum', '0x' + 'a'.repeat(64));
    await jest.advanceTimersByTimeAsync(35001);
    const result = await pending;
    expect(result.receipt).toEqual(receipt);
    expect(result.transaction).toEqual(tx);
    expect(result.status).toBe('confirmed');
    expect(result.gasUsed).toBe('21000');
    expect(result.temporaryFailure).toBe(true);
    expect(signal?.aborted).toBe(true);
  });
});

describe('metadata scheduling at the deadline', () => {
  afterEach(() => jest.useRealTimers());
  it('runs at most three metadata jobs and starts no further batches after cancellation', async () => {
    jest.useFakeTimers();
    const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const finish: Array<() => void> = [];
    const client = {
      getTransactionReceipt: jest
        .fn()
        .mockResolvedValue({
          status: '0x1',
          gasUsed: '0x5208',
          logs: Array.from({ length: 7 }, (_, i) => ({
            address: `0x${String(i).padStart(40, '0')}`,
            topics: [topic, '0x0', '0x0'],
          })),
        } as never),
      getTransactionByHash: jest.fn().mockResolvedValue({ input: '0x' } as never),
      fetchTokenMetadata: jest
        .fn<(chain: string, address: string) => Promise<unknown>>()
        .mockImplementation(
          (chain, address) =>
            new Promise((resolve) => {
              finish.push(() =>
                resolve({
                  contractAddress: address,
                  chain,
                  decimals: 18,
                  symbol: 'TEST',
                  name: 'Fixture',
                  isDegraded: false,
                }),
              );
            }),
        ),
    };
    const service = new EvmRpcService(client as unknown as EvmRpcClient, new TokenMetadataCache());
    const result = service.enrichTransaction('ethereum', '0x' + 'b'.repeat(64));
    await jest.advanceTimersByTimeAsync(35001);
    expect((await result).temporaryFailure).toBe(true);
    expect(client.fetchTokenMetadata).toHaveBeenCalledTimes(3);
    finish.forEach((resolve) => resolve());
    await jest.advanceTimersByTimeAsync(1);
    expect(client.fetchTokenMetadata).toHaveBeenCalledTimes(3);
  });
});
