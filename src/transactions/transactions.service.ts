import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';
import { buildTransactionCacheKey, resolveTransactionCacheTtl } from '../cache/cache.constants';
import { BlockchairService } from '../providers/blockchair/blockchair.service';
import { isBlockchairSupportedChain } from '../providers/blockchair/blockchair.constants';
import type { NormalizedTransaction } from '../providers/blockchair/blockchair.interface';
import { EvmRpcService } from '../providers/rpc/evm-rpc.service';
import type { RpcEnrichmentData } from '../providers/rpc/evm-rpc.interface';
import { StoryGeneratorService } from './story/story-generator.service';
import { HistoryService } from '../history/history.service';
import { ApiException } from '../common/exceptions/api.exception';
import { isUtxoChain } from '../common/constants/network-registry';
import type { TransactionLookupDto } from './dto/transaction-lookup.dto';
import type {
  EnrichedTransactionData,
  TransactionLookupResponse,
} from './dto/transaction-response.dto';

interface SharedLookup {
  data: EnrichedTransactionData;
  cacheHit: boolean;
  telemetry?: {
    provider: string;
    upstreamStatusCode: number | null;
    providerDurationMs: number | null;
  };
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  private inFlightLookups = new Map<string, Promise<SharedLookup>>();
  private refreshAfter = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly blockchairService: BlockchairService,
    private readonly rpcService: EvmRpcService,
    private readonly storyGenerator: StoryGeneratorService,
    private readonly historyService: HistoryService,
  ) {}

  async lookupTransaction(
    dto: TransactionLookupDto,
    userSession?: UserSession,
    customRequestId?: string,
  ): Promise<TransactionLookupResponse> {
    const requestId = customRequestId ?? crypto.randomUUID();
    const started = Date.now();
    const chain = dto.chain.toLowerCase();
    const hash = dto.transactionHash.toLowerCase();
    const key = `${chain}:${hash}`;
    let result: SharedLookup | undefined;
    let outcome = 'success';
    let statusCode: number | null = null;
    try {
      let promise = this.inFlightLookups.get(key);
      if (!promise) {
        if (dto.refresh) {
          const now = Date.now();
          for (const [entry, until] of this.refreshAfter)
            if (until <= now) this.refreshAfter.delete(entry);
          if ((this.refreshAfter.get(key) ?? 0) > now) {
            throw new ApiException(
              'RATE_LIMIT_EXCEEDED',
              'Please wait before refreshing this transaction again.',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          if (this.refreshAfter.size >= 10000)
            throw new ApiException(
              'RATE_LIMIT_EXCEEDED',
              'Refresh capacity reached. Please retry shortly.',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          this.refreshAfter.set(
            key,
            now + Number(process.env.REFRESH_COOLDOWN_SECONDS || 15) * 1000,
          );
        }
        // Shared work contains no session or caller request ID.
        promise = this.executeLookup(dto);
        this.inFlightLookups.set(key, promise);
        void promise.finally(() => this.inFlightLookups.delete(key)).catch(() => undefined);
      }
      result = await promise;
      return { data: result.data, meta: { cache: { hit: result.cacheHit }, requestId } };
    } catch (error) {
      if (error instanceof ApiException) {
        statusCode = error.getStatus();
        outcome =
          error.code === 'TRANSACTION_NOT_FOUND'
            ? 'not_found'
            : ['UPSTREAM_RATE_LIMITED', 'RATE_LIMIT_EXCEEDED'].includes(error.code)
              ? 'rate_limited'
              : 'upstream_error';
      } else outcome = 'upstream_error';
      throw error;
    } finally {
      await Promise.all([
        this.safeLogApiRequest({
          requestId,
          endpoint: `/${chain}/dashboards/transaction/${hash}`,
          chain,
          provider:
            result?.telemetry?.provider ??
            (isBlockchairSupportedChain(chain) ? 'blockchair' : 'evm_rpc'),
          cacheOutcome: result?.cacheHit ? 'hit' : 'miss',
          upstreamStatusCode: result?.telemetry?.upstreamStatusCode ?? statusCode,
          totalDurationMs: Date.now() - started,
          providerDurationMs: result?.telemetry?.providerDurationMs ?? null,
          outcome,
        }),
        userSession
          ? this.safeRecordHistory(userSession.id, {
              transactionHash: hash,
              chain,
              outcome,
              txStatus: result?.data.status ?? null,
              cacheHit: result?.cacheHit ?? false,
            })
          : Promise.resolve(),
      ]);
    }
  }

  private async executeLookup(dto: TransactionLookupDto): Promise<SharedLookup> {
    const startTime = Date.now();
    const chain = dto.chain.toLowerCase();
    const hash = dto.transactionHash.toLowerCase();
    const cacheKey = buildTransactionCacheKey(chain, hash);
    const shouldBypassCache = Boolean(dto.refresh);

    const cachedData = await this.cacheService.get<EnrichedTransactionData>(cacheKey);

    if (!shouldBypassCache && cachedData && this.isValidCachedData(cachedData, hash)) {
      const totalDurationMs = Date.now() - startTime;
      this.logger.debug(`Cache hit for ${cacheKey} in ${totalDurationMs}ms`);

      return {
        data: cachedData,
        cacheHit: true,
      };
    }

    if (isUtxoChain(chain)) {
      return await this.executeUtxoLookup(chain, hash, cacheKey);
    }

    return await this.executeEvmLookup(chain, hash, cacheKey);
  }

  private async executeUtxoLookup(
    chain: string,
    hash: string,
    cacheKey: string,
  ): Promise<SharedLookup> {
    const utxoResult = await this.blockchairService.getUtxoTransaction(chain, hash);
    const utxoTx = utxoResult.transaction;
    const providerDurationMs = utxoResult.providerDurationMs;
    const upstreamStatusCode = utxoResult.upstreamStatusCode;

    let explanation: string;
    if (utxoTx.isCoinbase) {
      explanation = `Coinbase transaction generating ${utxoTx.outputTotal.formatted} ${utxoTx.outputTotal.symbol} across ${utxoTx.outputCount} output${utxoTx.outputCount === 1 ? '' : 's'}.`;
    } else {
      const feeNote = utxoTx.feePerByte ? ` (${utxoTx.feePerByte} sat/byte)` : '';
      explanation = `Transaction with ${utxoTx.inputCount} input${utxoTx.inputCount === 1 ? '' : 's'} and ${utxoTx.outputCount} output${utxoTx.outputCount === 1 ? '' : 's'}. Total output: ${utxoTx.outputTotal.formatted} ${utxoTx.outputTotal.symbol}. Network fee: ${utxoTx.fee.formatted} ${utxoTx.fee.symbol}${feeNote}.`;
    }

    const enrichedData: EnrichedTransactionData = {
      transactionHash: utxoTx.transactionHash,
      chain: utxoTx.chain,
      family: 'utxo',
      status: utxoTx.status,
      blockNumber: utxoTx.blockNumber,
      timestamp: utxoTx.timestamp,
      explorerUrl: utxoTx.explorerUrl,
      fetchedAt: new Date().toISOString(),
      explanation,
      fee: utxoTx.fee,
      utxo: {
        size: utxoTx.size,
        weight: utxoTx.weight,
        vsize: utxoTx.vsize,
        isCoinbase: utxoTx.isCoinbase,
        confirmations: utxoTx.confirmations,
        referenceBlockHeight: utxoTx.referenceBlockHeight ?? null,
        inputCount: utxoTx.inputCount,
        outputCount: utxoTx.outputCount,
        inputTotal: utxoTx.inputTotal,
        outputTotal: utxoTx.outputTotal,
        feePerByte: utxoTx.feePerByte,
        inputsTruncated: utxoTx.inputsTruncated,
        outputsTruncated: utxoTx.outputsTruncated,
        inputs: utxoTx.inputs,
        outputs: utxoTx.outputs,
      },
    };

    // Low-confirmation snapshots expire sooner as confirmations and spent status change.
    const isLowConfirmations = utxoTx.status === 'confirmed' && utxoTx.confirmations < 6;
    const ttlSeconds = resolveTransactionCacheTtl(utxoTx.status, isLowConfirmations);
    if (ttlSeconds > 0) {
      await this.cacheService.set(cacheKey, enrichedData, ttlSeconds);
    }

    return {
      data: enrichedData,
      telemetry: { provider: 'blockchair', upstreamStatusCode, providerDurationMs },
      cacheHit: false,
    };
  }

  private async executeEvmLookup(
    chain: string,
    hash: string,
    cacheKey: string,
  ): Promise<SharedLookup> {
    let baseTx: NormalizedTransaction;
    let providerName = 'blockchair';
    let upstreamStatusCode: number | null = 200;
    let providerDurationMs: number | null = null;
    let enrichment: RpcEnrichmentData;

    if (isBlockchairSupportedChain(chain)) {
      // Query Blockchair and EVM RPC concurrently for supported EVM chains (Ethereum)
      const blockchairPromise = this.blockchairService
        .getTransaction(chain, hash)
        .then((res) => ({ ok: true as const, res }))
        .catch((err) => ({ ok: false as const, err }));

      const enrichmentPromise = this.rpcService.enrichTransaction(chain, hash);

      const [blockchairResult, rpcEnrichment] = await Promise.all([
        blockchairPromise,
        enrichmentPromise,
      ]);

      enrichment = rpcEnrichment;

      if (blockchairResult.ok) {
        baseTx = blockchairResult.res.transaction;
        upstreamStatusCode = blockchairResult.res.upstreamStatusCode;
        providerDurationMs = blockchairResult.res.providerDurationMs;
      } else {
        const err = blockchairResult.err;
        if (
          err instanceof ApiException &&
          err.code === 'TRANSACTION_NOT_FOUND' &&
          !enrichment.transaction &&
          !enrichment.receipt
        ) {
          throw err;
        }

        if (enrichment.transaction || enrichment.receipt) {
          this.logger.warn(
            `Blockchair lookup failed for ${chain}:${hash}, falling back to EVM RPC base transaction: ${err.message}`,
          );
          baseTx = this.rpcService.createBaseTransaction(chain, hash, enrichment);
          providerName = 'evm_rpc';
          upstreamStatusCode = 200;
        } else {
          throw err;
        }
      }
    } else {
      // Direct EVM RPC provider for legacy chains (BSC, Polygon)
      providerName = 'evm_rpc';
      const rpcStartTime = Date.now();
      enrichment = await this.rpcService.enrichTransaction(chain, hash);
      providerDurationMs = Date.now() - rpcStartTime;
      baseTx = this.rpcService.createBaseTransaction(chain, hash, enrichment);
    }

    let resolvedStatus = baseTx.status;
    let hasDiscrepancy = false;

    if (enrichment.receipt && enrichment.status !== 'unknown') {
      if (baseTx.status !== 'unknown' && baseTx.status !== enrichment.status) {
        this.logger.warn(
          `Status discrepancy for ${hash}: baseTx=${baseTx.status}, RPC receipt=${enrichment.status}`,
        );
        hasDiscrepancy = true;
        resolvedStatus = 'unknown';
      } else {
        resolvedStatus = enrichment.status;
      }
    }

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
      family: 'evm',
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

    // Status-aware TTL & degradation check
    const hasDegradedTokenMetadata = Array.from(enrichment.tokenMetadataMap.values()).some(
      (meta) => meta.isDegraded,
    );
    const isDegradedOrTemporaryFailure =
      enrichment.temporaryFailure ||
      hasDiscrepancy ||
      hasDegradedTokenMetadata ||
      story.coverage === 'partial' ||
      story.coverageReasons.includes('receipt_unavailable') ||
      story.coverageReasons.includes('temporary_enrichment_failure') ||
      story.coverageReasons.includes('metadata_unavailable');
    const ttlSeconds = resolveTransactionCacheTtl(resolvedStatus, isDegradedOrTemporaryFailure);

    // Monotonicity check: Prevent poorer responses from overwriting complete responses
    const existingCache = await this.cacheService.get<EnrichedTransactionData>(cacheKey);
    if (existingCache && this.isValidCachedData(existingCache, hash)) {
      const isSameBlock = String(existingCache.blockNumber) === String(baseTx.blockNumber);
      const existingIsComplete =
        existingCache.coverage === 'complete' ||
        !existingCache.coverageReasons?.includes('receipt_unavailable');
      const newIsDegraded = story.coverageReasons.includes('receipt_unavailable');

      if (isSameBlock && existingIsComplete && newIsDegraded) {
        this.logger.warn(
          `Preventing overwrite of complete cached data with degraded receipt_unavailable response for ${hash} on block #${baseTx.blockNumber}`,
        );
        return {
          data: existingCache,
          cacheHit: true,
        };
      }
    }

    if (ttlSeconds > 0) {
      await this.cacheService.set(cacheKey, enrichedData, ttlSeconds);
    }

    return {
      data: enrichedData,
      telemetry: { provider: providerName, upstreamStatusCode, providerDurationMs },
      cacheHit: false,
    };
  }

  private isValidCachedData(data: unknown, expectedHash: string): data is EnrichedTransactionData {
    if (!data || typeof data !== 'object') return false;
    const candidate = data as Partial<EnrichedTransactionData>;
    if (
      !candidate.transactionHash ||
      candidate.transactionHash.toLowerCase() !== expectedHash.toLowerCase()
    ) {
      return false;
    }
    if (
      typeof candidate.fetchedAt !== 'string' ||
      typeof candidate.explanation !== 'string' ||
      candidate.status === undefined
    ) {
      return false;
    }

    if (candidate.family === 'utxo') {
      return Boolean(
        candidate.utxo &&
        Array.isArray(candidate.utxo.inputs) &&
        Array.isArray(candidate.utxo.outputs),
      );
    }

    return Boolean(Array.isArray(candidate.actions) && Array.isArray(candidate.tokenTransfers));
  }

  private async safeLogApiRequest(data: {
    requestId: string;
    endpoint: string;
    chain: string;
    provider?: string;
    cacheOutcome: string;
    upstreamStatusCode: number | null;
    totalDurationMs: number;
    providerDurationMs: number | null;
    outcome: string;
  }): Promise<void> {
    if (!data.requestId) return;
    try {
      await this.prisma.apiRequestLog.create({
        data: {
          requestId: data.requestId,
          provider: data.provider || 'blockchair',
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
