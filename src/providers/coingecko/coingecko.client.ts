import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { COINGECKO_BASE_URL, COINGECKO_TIMEOUT_MS } from './coingecko.constants';
import type {
  CoinGeckoFetchResult,
  CoinMarketQuote,
  RawCoinGeckoSimplePriceResponse,
} from './coingecko.interface';

@Injectable()
export class CoinGeckoClient {
  private readonly logger = new Logger(CoinGeckoClient.name);
  private readonly httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: process.env.COINGECKO_BASE_URL || COINGECKO_BASE_URL,
      timeout: COINGECKO_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * Fetches market quotes (USD price and 24h change) for a batch of coin IDs.
   * Handles rate limiting (HTTP 429) without crashing or aggressive retry loops.
   */
  async fetchMarketPrices(coinIds: string[]): Promise<CoinGeckoFetchResult> {
    const fetchedAt = new Date().toISOString();
    if (!coinIds.length) {
      return { data: {}, isRateLimited: false, fetchedAt };
    }

    const uniqueIds = Array.from(new Set(coinIds)).join(',');
    const endpoint = '/simple/price';
    const params: Record<string, string | boolean> = {
      ids: uniqueIds,
      vs_currencies: 'usd',
      include_24hr_change: true,
    };

    const headers: Record<string, string> = {};
    const apiKey = process.env.COINGECKO_API_KEY?.trim();
    if (apiKey) {
      headers['x-cg-demo-api-key'] = apiKey;
    }

    try {
      const response = await this.httpClient.get<RawCoinGeckoSimplePriceResponse>(endpoint, {
        params,
        headers,
      });

      const raw = response.data;
      const data: Record<string, CoinMarketQuote> = {};

      for (const id of coinIds) {
        const item = raw?.[id];
        if (item && typeof item.usd === 'number' && Number.isFinite(item.usd)) {
          data[id] = {
            priceUsd: item.usd,
            change24h:
              typeof item.usd_24h_change === 'number' && Number.isFinite(item.usd_24h_change)
                ? item.usd_24h_change
                : null,
          };
        } else {
          data[id] = {
            priceUsd: null,
            change24h: null,
          };
        }
      }

      return {
        data,
        isRateLimited: false,
        fetchedAt,
      };
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;

        if (status === 429) {
          this.logger.warn('CoinGecko rate limit encountered (HTTP 429).');
          return {
            data: null,
            isRateLimited: true,
            error: 'CoinGecko API rate limit reached (HTTP 429).',
            fetchedAt,
          };
        }

        this.logger.warn(
          `CoinGecko HTTP error: ${status || axiosErr.code} - ${axiosErr.message}`,
        );
        return {
          data: null,
          isRateLimited: false,
          error: `CoinGecko provider error (${status || axiosErr.code || 'network error'}).`,
          fetchedAt,
        };
      }

      this.logger.warn(`CoinGecko unknown fetch error: ${(err as Error).message}`);
      return {
        data: null,
        isRateLimited: false,
        error: (err as Error).message,
        fetchedAt,
      };
    }
  }
}
