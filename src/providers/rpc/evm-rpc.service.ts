import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';
import { formatUnits, getExplorerUrl, getNativeSymbol } from '../../common/utils/evm.utils';
import type { NormalizedTransaction } from '../blockchair/blockchair.interface';
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

    const targetAddress = tx?.to || receipt?.to;
    const codePromise = (async (): Promise<boolean | null> => {
      if (targetAddress) {
        try {
          const code = await this.rpcClient.getCode(chain, targetAddress);
          if (code !== null) {
            return code !== '0x' && code !== '0x0' && code.length > 2;
          }
        } catch {
          return null;
        }
      } else if (tx && tx.to === null) {
        return true;
      }
      return null;
    })();

    const blockNumberHex = receipt?.blockNumber || tx?.blockNumber;
    const blockPromise = (async (): Promise<string | null> => {
      if (blockNumberHex && blockNumberHex !== '0x0') {
        try {
          const block = await this.rpcClient.getBlockByNumber(chain, blockNumberHex);
          if (block?.timestamp) {
            const tsSec = Number(BigInt(block.timestamp));
            if (!Number.isNaN(tsSec) && tsSec > 0) {
              return new Date(tsSec * 1000).toISOString();
            }
          }
        } catch (err) {
          this.logger.debug(
            `Could not resolve block timestamp for ${blockNumberHex} on ${chain}: ${(err as Error).message}`,
          );
        }
      }
      return null;
    })();

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

    const metadataPromise = (async (): Promise<Map<string, TokenMetadata>> => {
      const tokenMetadataMap = new Map<string, TokenMetadata>();
      if (candidateTokens.size > 0) {
        const tokensArray = Array.from(candidateTokens);
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
      return tokenMetadataMap;
    })();

    const [toIsContract, blockTimestamp, tokenMetadataMap] = await Promise.all([
      codePromise,
      blockPromise,
      metadataPromise,
    ]);

    return {
      receipt,
      transaction: tx,
      inputData,
      gasUsed,
      status,
      logs,
      tokenMetadataMap,
      temporaryFailure: false,
      toIsContract,
      blockTimestamp,
    };
  }

  /**
   * Constructs normalized transaction data from EVM RPC receipt, transaction, and block.
   * Throws TRANSACTION_NOT_FOUND if neither transaction nor receipt exists on-chain.
   */
  createBaseTransaction(
    chain: string,
    transactionHash: string,
    enrichment: RpcEnrichmentData,
  ): NormalizedTransaction {
    const normalizedHash = transactionHash.toLowerCase();
    const tx = enrichment.transaction;
    const receipt = enrichment.receipt;

    if (!tx && !receipt) {
      if (enrichment.temporaryFailure) {
        throw new ApiException(
          'UPSTREAM_PROVIDER_ERROR',
          'Failed to reach blockchain RPC provider or request timed out.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      throw new ApiException(
        'TRANSACTION_NOT_FOUND',
        'The transaction hash does not exist or has not been confirmed on the chosen chain.',
        HttpStatus.NOT_FOUND,
      );
    }

    const from = (tx?.from || receipt?.from || '').toLowerCase();
    const to = tx?.to
      ? tx.to.toLowerCase()
      : receipt?.to
        ? receipt.to.toLowerCase()
        : receipt?.contractAddress
          ? receipt.contractAddress.toLowerCase()
          : null;

    const rawValue = tx?.value ? BigInt(tx.value).toString() : '0';
    const nativeSymbol = getNativeSymbol(chain);

    let feeRaw = '0';
    if (receipt && receipt.gasUsed) {
      const gasUsed = BigInt(receipt.gasUsed);
      const gasPrice = receipt.effectiveGasPrice
        ? BigInt(receipt.effectiveGasPrice)
        : tx?.gasPrice
          ? BigInt(tx.gasPrice)
          : 0n;
      feeRaw = (gasUsed * gasPrice).toString();
    }

    const rawBlock = receipt?.blockNumber || tx?.blockNumber;
    const blockNumber = rawBlock ? String(BigInt(rawBlock)) : '0';

    return {
      transactionHash: tx?.hash ? tx.hash.toLowerCase() : normalizedHash,
      chain: chain.toLowerCase(),
      status: enrichment.status,
      from,
      to,
      value: {
        raw: rawValue,
        formatted: formatUnits(rawValue, 18),
        symbol: nativeSymbol,
      },
      fee: {
        raw: feeRaw,
        formatted: formatUnits(feeRaw, 18),
        symbol: nativeSymbol,
      },
      blockNumber,
      timestamp: enrichment.blockTimestamp ?? null,
      explorerUrl: getExplorerUrl(chain, normalizedHash),
    };
  }
}
