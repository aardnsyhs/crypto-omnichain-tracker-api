import { Injectable, Logger } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';
import { buildTransactionCacheKey, resolveTransactionCacheTtl } from '../cache/cache.constants';
import { BlockchairService } from '../providers/blockchair/blockchair.service';
import { EvmRpcService } from '../providers/rpc/evm-rpc.service';
import { StoryGeneratorService } from './story/story-generator.service';
import { HistoryService } from '../history/history.service';
import { ApiException } from '../common/exceptions/api.exception';
import type { TransactionLookupDto } from './dto/transaction-lookup.dto';
import type {
  EnrichedTransactionData,
  TransactionLookupResponse,
} from './dto/transaction-response.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly blockchairService: BlockchairService,
    private readonly rpcService: EvmRpcService,
    private readonly storyGenerator: StoryGeneratorService,
    private readonly historyService: HistoryService,
  ) {}

  /**
   * Executes the transaction lookup flow:
   * 1. Cache-aside check with schema validation (bypassed if TTL=0 or invalid shape)
   * 2. Upstream Blockchair fetch on cache miss
   * 3. Parallel/graceful EVM RPC enrichment for logs, receipts, and token metadata
   * 4. Provider reconciliation and deterministic story generation
   * 5. Status-aware Redis cache write (preserving fetchedAt)
   * 6. Persistence of API request logs and search history with separated txStatus
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
    const cachedData = await this.cacheService.get<EnrichedTransactionData>(cacheKey);

    if (cachedData && this.isValidCachedData(cachedData, hash)) {
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
          txStatus: cachedData.status,
          cacheHit: true,
        });
      }

      return {
        data: cachedData, // returns preserved fetchedAt as originally stored
        meta: {
          requestId,
          cache: {
            hit: true,
          },
        },
      };
    }

    // 2. Cache miss -> query Blockchair and EVM RPC provider
    try {
      const [providerResult, enrichment] = await Promise.all([
        this.blockchairService.getTransaction(chain, hash),
        this.rpcService.enrichTransaction(chain, hash),
      ]);

      const baseTx = providerResult.transaction;

      // 3. Provider Reconciliation: Detect discrepancies between Blockchair and RPC receipt
      let resolvedStatus = baseTx.status;
      let hasDiscrepancy = false;

      if (enrichment.receipt && enrichment.status !== 'unknown') {
        if (baseTx.status !== 'unknown' && baseTx.status !== enrichment.status) {
          this.logger.warn(
            `Status discrepancy for ${hash}: Blockchair=${baseTx.status}, RPC receipt=${enrichment.status}`,
          );
          hasDiscrepancy = true;
          resolvedStatus = 'unknown';
        } else {
          resolvedStatus = enrichment.status;
        }
      }

      // 4. Generate deterministic Transaction Story
      const story = this.storyGenerator.generateStory(
        baseTx,
        enrichment,
        resolvedStatus,
        hasDiscrepancy,
      );

      const fetchedAt = new Date().toISOString();

      const enrichedData: EnrichedTransactionData = {
        transactionHash: baseTx.transactionHash,
        chain: baseTx.chain,
        status: resolvedStatus,
        from: baseTx.from,
        to: baseTx.to,
        value: baseTx.value,
        fee: baseTx.fee,
        blockNumber: baseTx.blockNumber,
        timestamp: baseTx.timestamp,
        explorerUrl: baseTx.explorerUrl,
        fetchedAt,
        explanation: story.explanation,
        coverage: story.coverage,
        coverageReasons: story.coverageReasons,
        actions: story.actions,
        tokenTransfers: story.tokenTransfers,
        approvals: story.approvals,
        technical: {
          gasUsed: enrichment.gasUsed,
          inputData: enrichment.inputData,
        },
      };

      const totalDurationMs = Date.now() - startTime;

      // 5. Store normalized result in Redis with status-based TTL
      const isDegradedOrTemporaryFailure =
        enrichment.temporaryFailure ||
        hasDiscrepancy ||
        story.coverageReasons.includes('temporary_enrichment_failure') ||
        story.coverageReasons.includes('metadata_unavailable');
      const ttlSeconds = resolveTransactionCacheTtl(resolvedStatus, isDegradedOrTemporaryFailure);

      if (ttlSeconds > 0) {
        await this.cacheService.set(cacheKey, enrichedData, ttlSeconds);
      }

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
          txStatus: resolvedStatus,
          cacheHit: false,
        });
      }

      return {
        data: enrichedData,
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
          txStatus: null, // unknown
          cacheHit: false,
        });
      }

      throw error;
    }
  }

  /**
   * Validates cached data shape to prevent legacy v1 entries from breaking the new response.
   */
  private isValidCachedData(data: unknown, expectedHash: string): data is EnrichedTransactionData {
    if (!data || typeof data !== 'object') return false;
    const candidate = data as Partial<EnrichedTransactionData>;
    return Boolean(
      candidate.transactionHash &&
      candidate.transactionHash.toLowerCase() === expectedHash.toLowerCase() &&
      typeof candidate.fetchedAt === 'string' &&
      typeof candidate.explanation === 'string' &&
      Array.isArray(candidate.actions) &&
      Array.isArray(candidate.tokenTransfers) &&
      candidate.status !== undefined,
    );
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
      txStatus: 'confirmed' | 'failed' | 'pending' | 'unknown' | null;
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
