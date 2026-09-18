import { Injectable, Logger } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';
import { buildTransactionCacheKey } from '../cache/cache.constants';
import { BlockchairService } from '../providers/blockchair/blockchair.service';
import type { NormalizedTransaction } from '../providers/blockchair/blockchair.interface';
import { HistoryService } from '../history/history.service';
import { ApiException } from '../common/exceptions/api.exception';
import type { TransactionLookupDto } from './dto/transaction-lookup.dto';
import type { TransactionLookupResponse } from './dto/transaction-response.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly blockchairService: BlockchairService,
    private readonly historyService: HistoryService,
  ) {}

  /**
   * Executes the transaction lookup flow:
   * 1. Cache-aside check with canonical key format
   * 2. Upstream Blockchair fetch on cache miss
   * 3. Redis cache write on successful lookup
   * 4. Asynchronous logging of API_REQUEST_LOG and SEARCH_HISTORY
   */
  async lookupTransaction(
    dto: TransactionLookupDto,
    userSession?: UserSession,
    customRequestId?: string,
  ): Promise<TransactionLookupResponse> {
    const requestId = customRequestId || crypto.randomUUID();
    const startTime = Date.now();
    const chain = dto.chain.toLowerCase();
    const hash = dto.transactionHash.toLowerCase();
    const cacheKey = buildTransactionCacheKey(chain, hash);
    const endpoint = `/${chain}/dashboards/transaction/${hash}`;

    // 1. Check Redis cache-aside
    const cachedTransaction = await this.cacheService.get<NormalizedTransaction>(cacheKey);

    if (cachedTransaction) {
      const totalDurationMs = Date.now() - startTime;
      this.logger.debug(`Cache hit for ${cacheKey} in ${totalDurationMs}ms`);

      // Safe persistence of request log and search history
      void this.safeLogApiRequest({
        requestId,
        endpoint,
        chain,
        cacheOutcome: 'hit',
        upstreamStatusCode: null,
        totalDurationMs,
        providerDurationMs: null,
        outcome: 'success',
      });

      if (userSession) {
        void this.safeRecordHistory(userSession.id, {
          transactionHash: hash,
          chain,
          outcome: 'success',
          cacheHit: true,
        });
      }

      return {
        data: cachedTransaction,
        meta: {
          requestId,
          cache: {
            hit: true,
          },
        },
      };
    }

    // 2. Cache miss -> query Blockchair provider
    try {
      const providerResult = await this.blockchairService.getTransaction(chain, hash);
      const totalDurationMs = Date.now() - startTime;

      // 3. Store normalized successful result in Redis
      await this.cacheService.set(cacheKey, providerResult.transaction);

      // Safe persistence
      void this.safeLogApiRequest({
        requestId,
        endpoint,
        chain,
        cacheOutcome: 'miss',
        upstreamStatusCode: providerResult.upstreamStatusCode,
        totalDurationMs,
        providerDurationMs: providerResult.providerDurationMs,
        outcome: 'success',
      });

      if (userSession) {
        void this.safeRecordHistory(userSession.id, {
          transactionHash: hash,
          chain,
          outcome: 'success',
          cacheHit: false,
        });
      }

      return {
        data: providerResult.transaction,
        meta: {
          requestId,
          cache: {
            hit: false,
          },
        },
      };
    } catch (error) {
      const totalDurationMs = Date.now() - startTime;
      let outcome = 'upstream_error';

      if (error instanceof ApiException) {
        if (error.code === 'TRANSACTION_NOT_FOUND') {
          outcome = 'not_found';
        } else if (error.code === 'UPSTREAM_RATE_LIMITED') {
          outcome = 'rate_limited';
        }
      }

      void this.safeLogApiRequest({
        requestId,
        endpoint,
        chain,
        cacheOutcome: 'miss',
        upstreamStatusCode: error instanceof ApiException ? error.getStatus() : null,
        totalDurationMs,
        providerDurationMs: null,
        outcome,
      });

      if (userSession) {
        void this.safeRecordHistory(userSession.id, {
          transactionHash: hash,
          chain,
          outcome,
          cacheHit: false,
        });
      }

      throw error;
    }
  }

  private async safeLogApiRequest(data: {
    requestId: string;
    endpoint: string;
    chain: string;
    cacheOutcome: string;
    upstreamStatusCode: number | null;
    totalDurationMs: number;
    providerDurationMs: number | null;
    outcome: string;
  }): Promise<void> {
    try {
      await this.prisma.apiRequestLog.create({
        data: {
          requestId: data.requestId,
          provider: 'blockchair',
          endpoint: data.endpoint,
          chain: data.chain,
          cacheOutcome: data.cacheOutcome,
          upstreamStatusCode: data.upstreamStatusCode,
          totalDurationMs: data.totalDurationMs,
          providerDurationMs: data.providerDurationMs,
          outcome: data.outcome,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist API request log: ${(err as Error).message}`);
    }
  }

  private async safeRecordHistory(
    userSessionId: string,
    data: {
      transactionHash: string;
      chain: string;
      outcome: string;
      cacheHit: boolean;
    },
  ): Promise<void> {
    try {
      await this.historyService.recordSearch(userSessionId, data);
    } catch (err) {
      this.logger.warn(`Failed to persist search history: ${(err as Error).message}`);
    }
  }
}
