import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  getBlockchairBaseUrl,
  getBlockchairSlug,
  getBlockchairTimeoutMs,
} from './blockchair.constants';
import type { RawBlockchairResponse } from './blockchair.interface';

export interface BlockchairRawFetchResult {
  data: RawBlockchairResponse;
  statusCode: number;
  durationMs: number;
}

@Injectable()
export class BlockchairClient {
  private readonly logger = new Logger(BlockchairClient.name);
  private readonly httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: getBlockchairBaseUrl(),
      timeout: getBlockchairTimeoutMs(),
    });
  }

  /**
   * Fetches raw transaction dashboard from Blockchair API with timeout and error mapping.
   */
  async fetchTransaction(
    chain: string,
    transactionHash: string,
  ): Promise<BlockchairRawFetchResult> {
    const slug = getBlockchairSlug(chain);
    const endpoint = `/${slug}/dashboards/transaction/${transactionHash.toLowerCase()}`;
    const apiKey = process.env.BLOCKCHAIR_API_KEY?.trim();

    const params: Record<string, string> = {};
    if (apiKey) {
      params.key = apiKey;
    }

    const startTime = Date.now();

    try {
      const response = await this.httpClient.get<RawBlockchairResponse>(endpoint, {
        params,
      });
      const durationMs = Date.now() - startTime;

      return {
        data: response.data,
        statusCode: response.status,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosErr = error as AxiosError;
        const status = axiosErr.response?.status;

        // Approved Decision 2: Map 402 and 429 to 503 UPSTREAM_RATE_LIMITED
        if (status === 402 || status === 429) {
          this.logger.warn(`Blockchair rate limit or quota exceeded (HTTP ${status})`);
          throw new ApiException(
            'UPSTREAM_RATE_LIMITED',
            'Upstream provider quota was exhausted.',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }

        // Map 404: Distinguish upstream route/provider 404 (e.g. HTML) from true JSON 404
        if (status === 404) {
          const contentType = String(axiosErr.response?.headers?.['content-type'] || '');
          const responseData = axiosErr.response?.data;
          const isHtml =
            typeof responseData === 'string' &&
            (responseData.includes('<!DOCTYPE') ||
              responseData.includes('<html') ||
              responseData.includes('Page Not Found'));

          if (isHtml || (!contentType.includes('application/json') && contentType !== '')) {
            this.logger.warn(
              `Blockchair upstream route not found or invalid (HTTP 404 HTML) on ${endpoint}`,
            );
            throw new ApiException(
              'UPSTREAM_PROVIDER_ERROR',
              'Upstream provider route is invalid or unsupported.',
              HttpStatus.BAD_GATEWAY,
            );
          }

          throw new ApiException(
            'TRANSACTION_NOT_FOUND',
            'The transaction hash does not exist or has not been confirmed on the chosen chain.',
            HttpStatus.NOT_FOUND,
          );
        }

        // Timeout mapping
        if (
          axiosErr.code === 'ECONNABORTED' ||
          axiosErr.code === 'ETIMEDOUT' ||
          axiosErr.message.toLowerCase().includes('timeout')
        ) {
          this.logger.warn(`Blockchair request timed out after ${durationMs}ms`);
          throw new ApiException(
            'UPSTREAM_TIMEOUT',
            'Upstream provider request exceeded configured deadline.',
            HttpStatus.BAD_GATEWAY,
          );
        }

        this.logger.warn(
          `Blockchair upstream provider error (HTTP ${status ?? 'NONE'}): ${axiosErr.message}`,
        );
        throw new ApiException(
          'UPSTREAM_PROVIDER_ERROR',
          'Blockchair returned an unrecoverable error or invalid payload.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      throw new ApiException(
        'UPSTREAM_PROVIDER_ERROR',
        'Unexpected provider request failure.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
