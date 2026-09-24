import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { CoinGeckoClient } from './coingecko.client';
import { COINGECKO_COIN_IDS } from './coingecko.constants';

describe('CoinGeckoClient', () => {
  let client: CoinGeckoClient;
  let mockGet: ReturnType<typeof jest.fn>;

  beforeEach(async () => {
    mockGet = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoinGeckoClient],
    }).compile();

    client = module.get<CoinGeckoClient>(CoinGeckoClient);
    (client as any).httpClient = {
      get: mockGet,
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('correctly maps coin IDs for ethereum, bsc, and polygon', () => {
    expect(COINGECKO_COIN_IDS.ethereum).toBe('ethereum');
    expect(COINGECKO_COIN_IDS.bsc).toBe('binancecoin');
    expect(COINGECKO_COIN_IDS.polygon).toBe('polygon-ecosystem-token');
  });

  it('batches coin IDs in a single request and parses valid quotes', async () => {
    const mockApiResponse = {
      ethereum: {
        usd: 2650.5,
        usd_24h_change: 2.345,
      },
      binancecoin: {
        usd: 775.1,
        usd_24h_change: -1.2,
      },
      'polygon-ecosystem-token': {
        usd: 0.105,
        usd_24h_change: 0.0,
      },
    };

    mockGet.mockResolvedValueOnce({
      data: mockApiResponse,
      status: 200,
    } as never);

    const result = await client.fetchMarketPrices([
      'ethereum',
      'binancecoin',
      'polygon-ecosystem-token',
    ]);

    expect(mockGet).toHaveBeenCalledWith('/simple/price', {
      params: {
        ids: 'ethereum,binancecoin,polygon-ecosystem-token',
        vs_currencies: 'usd',
        include_24hr_change: true,
      },
      headers: {},
    });

    expect(result.isRateLimited).toBe(false);
    expect(result.data).toBeDefined();
    expect(result.data?.ethereum).toEqual({
      priceUsd: 2650.5,
      change24h: 2.345,
    });
    expect(result.data?.binancecoin).toEqual({
      priceUsd: 775.1,
      change24h: -1.2,
    });
    expect(result.data?.['polygon-ecosystem-token']).toEqual({
      priceUsd: 0.105,
      change24h: 0.0,
    });
  });

  it('handles partial response with missing coin fields by assigning null instead of 0', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        ethereum: {
          usd: 2600.0,
          usd_24h_change: null,
        },
      },
      status: 200,
    } as never);

    const result = await client.fetchMarketPrices(['ethereum', 'binancecoin']);

    expect(result.isRateLimited).toBe(false);
    expect(result.data?.ethereum).toEqual({
      priceUsd: 2600.0,
      change24h: null,
    });
    expect(result.data?.binancecoin).toEqual({
      priceUsd: null,
      change24h: null,
    });
  });

  it('handles HTTP 429 rate limit gracefully without throwing', async () => {
    const error429 = {
      isAxiosError: true,
      response: {
        status: 429,
        data: { status: { error_code: 429, error_message: "You've exceeded the Rate Limit." } },
      },
      message: 'Request failed with status code 429',
    };
    mockGet.mockRejectedValueOnce(error429 as never);

    // Mock axios.isAxiosError
    const originalIsAxiosError = axios.isAxiosError;
    (axios as any).isAxiosError = (err: any) => err?.isAxiosError === true;

    try {
      const result = await client.fetchMarketPrices(['ethereum']);

      expect(result.isRateLimited).toBe(true);
      expect(result.data).toBeNull();
      expect(result.error).toContain('429');
    } finally {
      (axios as any).isAxiosError = originalIsAxiosError;
    }
  });

  it('handles general network errors gracefully', async () => {
    const networkError = {
      isAxiosError: true,
      message: 'connect ECONNREFUSED',
      code: 'ECONNREFUSED',
    };
    mockGet.mockRejectedValueOnce(networkError as never);

    const originalIsAxiosError = axios.isAxiosError;
    (axios as any).isAxiosError = (err: any) => err?.isAxiosError === true;

    try {
      const result = await client.fetchMarketPrices(['ethereum']);

      expect(result.isRateLimited).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toContain('ECONNREFUSED');
    } finally {
      (axios as any).isAxiosError = originalIsAxiosError;
    }
  });
});
