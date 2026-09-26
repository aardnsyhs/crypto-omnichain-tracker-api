import { jest } from '@jest/globals';
import { TransactionsController } from './transactions.controller';
import type { TransactionsService } from './transactions.service';
import type { TransactionLookupDto } from './dto/transaction-lookup.dto';
import type { TransactionLookupResponse } from './dto/transaction-response.dto';
import type { UserSession } from '@prisma/client';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let mockService: Partial<Record<keyof TransactionsService, jest.Mock>>;

  beforeEach(() => {
    mockService = {
      lookupTransaction: jest.fn(),
    };
    controller = new TransactionsController(mockService as unknown as TransactionsService);
  });

  it('delegates lookup to TransactionsService and returns result', async () => {
    const mockDto: TransactionLookupDto = {
      chain: 'ethereum',
      transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    const mockSession: UserSession = {
      id: 'session-id',
      sessionId: 'session-token',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };

    const mockResponse: TransactionLookupResponse = {
      data: {
        transactionHash: mockDto.transactionHash.toLowerCase(),
        chain: 'ethereum',
        family: 'evm',
        status: 'confirmed',
        blockNumber: '100',
        timestamp: '2026-09-01T12:00:00Z',
        fetchedAt: '2026-09-01T12:00:05Z',
        explanation: 'Transferred 0.000000000000001 ETH from 0xfrom to 0xto.',
        coverage: 'complete',
        coverageReasons: [],
        actions: [],
        tokenTransfers: [],
        approvals: [],
        from: '0xfrom',
        to: '0xto',
        value: {
          raw: '1000',
          formatted: '0.000000000000001',
          symbol: 'ETH',
        },
        fee: {
          raw: '100',
          formatted: '0.0000000000000001',
          symbol: 'ETH',
        },
        explorerUrl: 'https://etherscan.io/tx/0x123',
      },
      meta: {
        requestId: 'req-123',
        cache: {
          hit: false,
        },
      },
    };

    (mockService.lookupTransaction as jest.Mock).mockResolvedValue(mockResponse as never);

    const result = await controller.lookup(mockDto, mockSession, 'req-123');

    expect(mockService.lookupTransaction).toHaveBeenCalledWith(mockDto, mockSession, 'req-123');
    expect(result).toEqual(mockResponse);
  });
});
