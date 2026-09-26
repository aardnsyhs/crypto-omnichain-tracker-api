import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import type { OverviewResponse } from './overview.interface';

describe('OverviewController', () => {
  let controller: OverviewController;
  let service: { getOverview: ReturnType<typeof jest.fn> };

  beforeEach(async () => {
    service = {
      getOverview: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [{ provide: OverviewService, useValue: service }],
    }).compile();

    controller = module.get<OverviewController>(OverviewController);
  });

  it('delegates getOverview to OverviewService', async () => {
    const mockResponse: OverviewResponse = {
      data: [
        {
          chain: 'ethereum',
          name: 'Ethereum',
          nativeSymbol: 'ETH',
          family: 'evm',
          market: {
            priceUsd: 2600,
            change24h: 1.2,
            source: 'Blockchair',
            updatedAt: '2026-09-24T12:00:00.000Z',
            isStale: false,
            status: 'available',
          },
          network: {
            latestBlockNumber: 26047264,
            latestBlockTimestamp: 1789657008,
            blockDate: '2026-09-24T12:00:00.000Z',
            suggestedGasPriceWei: '366270253',
            suggestedGasPriceGwei: '0.366270253',
            suggestedFeeRate: '0.366270253',
            feeUnit: 'Gwei',
            source: 'Blockchair',
            updatedAt: '2026-09-24T12:00:00.000Z',
            isStale: false,
            status: 'available',
          },
        },
      ],
      meta: {
        fetchedAt: '2026-09-24T12:00:00.000Z',
        cached: false,
      },
    };

    service.getOverview.mockResolvedValueOnce(mockResponse as never);

    const result = await controller.getOverview();
    expect(result).toBe(mockResponse);
    expect(service.getOverview).toHaveBeenCalledTimes(1);
  });
});
