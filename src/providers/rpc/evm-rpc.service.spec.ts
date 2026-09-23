import { jest } from '@jest/globals';
import { EvmRpcService } from './evm-rpc.service';
import type { EvmRpcClient } from './evm-rpc.client';
import { TokenMetadataCache } from './token-metadata.cache';

describe('EvmRpcService', () => {
  let service: EvmRpcService;
  let mockClient: {
    getTransactionReceipt: jest.Mock;
    getTransactionByHash: jest.Mock;
    fetchTokenMetadata: jest.Mock;
  };
  let metadataCache: TokenMetadataCache;

  beforeEach(() => {
    mockClient = {
      getTransactionReceipt: jest.fn(),
      getTransactionByHash: jest.fn(),
      fetchTokenMetadata: jest.fn(),
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
