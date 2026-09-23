import { Injectable, Logger } from '@nestjs/common';
import { EvmRpcClient } from './evm-rpc.client';
import { TokenMetadataCache } from './token-metadata.cache';
import {
  ERC20_APPROVAL_TOPIC0,
  ERC20_TRANSFER_TOPIC0,
  MAX_METADATA_CONCURRENCY,
  TOTAL_ENRICHMENT_DEADLINE_MS,
} from './evm-rpc.constants';
import type { RpcEnrichmentData, RpcLog, TokenMetadata } from './evm-rpc.interface';

@Injectable()
export class EvmRpcService {
  private readonly logger = new Logger(EvmRpcService.name);

  constructor(
    private readonly rpcClient: EvmRpcClient,
    private readonly metadataCache: TokenMetadataCache,
  ) {}

  /**
   * Enriches a transaction with RPC receipt, logs, input, and token metadata.
   * Bound by a total timeout deadline to prevent holding up client responses.
   */
  async enrichTransaction(chain: string, transactionHash: string): Promise<RpcEnrichmentData> {
    const defaultData: RpcEnrichmentData = {
      receipt: null,
      transaction: null,
      inputData: null,
      gasUsed: null,
      status: 'unknown',
      logs: [],
      tokenMetadataMap: new Map(),
      temporaryFailure: false,
    };

    try {
      const enrichmentPromise = this.performEnrichment(chain, transactionHash);

      // Race with overall deadline
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Enrichment deadline of ${TOTAL_ENRICHMENT_DEADLINE_MS}ms exceeded`)),
          TOTAL_ENRICHMENT_DEADLINE_MS,
        ),
      );

      return await Promise.race([enrichmentPromise, timeoutPromise]);
    } catch (err) {
      this.logger.warn(
        `RPC enrichment degraded for ${chain}:${transactionHash}: ${(err as Error).message}`,
      );
      return {
        ...defaultData,
        temporaryFailure: true,
        failureReason: (err as Error).message,
      };
    }
  }

  private async performEnrichment(
    chain: string,
    transactionHash: string,
  ): Promise<RpcEnrichmentData> {
    const [receipt, tx] = await Promise.all([
      this.rpcClient.getTransactionReceipt(chain, transactionHash),
      this.rpcClient.getTransactionByHash(chain, transactionHash),
    ]);

    let status: 'confirmed' | 'failed' | 'pending' | 'unknown' = 'unknown';
    if (receipt) {
      if (receipt.status === '0x1') {
        status = 'confirmed';
      } else if (receipt.status === '0x0') {
        status = 'failed';
      }
    }

    const logs: RpcLog[] = receipt?.logs ?? [];
    const inputData = tx?.input && tx.input !== '0x' ? tx.input : null;
    const gasUsed = receipt?.gasUsed ? String(BigInt(receipt.gasUsed)) : null;

    // Discover unique tokens from Transfer and Approval event logs
    const candidateTokens = new Set<string>();
    for (const log of logs) {
      if (!log.topics || log.topics.length === 0) continue;
      const topic0 = log.topics[0]?.toLowerCase();
      if (
        (topic0 === ERC20_TRANSFER_TOPIC0 && log.topics.length === 3) ||
        (topic0 === ERC20_APPROVAL_TOPIC0 && log.topics.length === 3)
      ) {
        if (log.address) {
          candidateTokens.add(log.address.toLowerCase());
        }
      }
    }

    const tokenMetadataMap = new Map<string, TokenMetadata>();

    if (candidateTokens.size > 0) {
      const tokensArray = Array.from(candidateTokens);
      // Fetch metadata with bounded concurrency
      for (let i = 0; i < tokensArray.length; i += MAX_METADATA_CONCURRENCY) {
        const batch = tokensArray.slice(i, i + MAX_METADATA_CONCURRENCY);
        const results = await Promise.all(
          batch.map((tokenAddress) =>
            this.metadataCache.deduplicate(chain, tokenAddress, () =>
              this.rpcClient.fetchTokenMetadata(chain, tokenAddress),
            ),
          ),
        );

        for (const meta of results) {
          tokenMetadataMap.set(meta.contractAddress.toLowerCase(), meta);
        }
      }
    }

    return {
      receipt,
      transaction: tx,
      inputData,
      gasUsed,
      status,
      logs,
      tokenMetadataMap,
      temporaryFailure: false,
    };
  }
}
