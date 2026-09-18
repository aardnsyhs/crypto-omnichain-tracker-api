import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';
import { formatUnits, getExplorerUrl, getNativeSymbol } from '../../common/utils/evm.utils';
import { BlockchairClient } from './blockchair.client';
import type {
  NormalizedTransaction,
  ProviderResult,
  RawBlockchairResponse,
} from './blockchair.interface';

@Injectable()
export class BlockchairService {
  private readonly logger = new Logger(BlockchairService.name);

  constructor(private readonly client: BlockchairClient) {}

  /**
   * Looks up and normalizes an EVM transaction from Blockchair.
   */
  async getTransaction(chain: string, transactionHash: string): Promise<ProviderResult> {
    const rawResult = await this.client.fetchTransaction(chain, transactionHash);
    const normalized = this.normalizeResponse(chain, transactionHash, rawResult.data);

    return {
      transaction: normalized,
      upstreamStatusCode: rawResult.statusCode,
      providerDurationMs: rawResult.durationMs,
    };
  }

  /**
   * Pure normalization method for converting raw Blockchair payload into internal transaction DTO.
   */
  normalizeResponse(
    chain: string,
    transactionHash: string,
    raw: RawBlockchairResponse,
  ): NormalizedTransaction {
    const normalizedHash = transactionHash.toLowerCase();
    const dataDict = raw?.data;

    // Check for explicit error code in context or empty data
    if (raw?.context?.code === 404 || !dataDict) {
      throw new ApiException(
        'TRANSACTION_NOT_FOUND',
        'The transaction hash does not exist or has not been confirmed on the chosen chain.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Blockchair indexes transaction by lowercase or raw hash, or single object
    const entry =
      dataDict[normalizedHash] ?? dataDict[transactionHash] ?? Object.values(dataDict)[0];

    const tx = entry?.transaction;

    // Approved Decision 2: Normalize empty/null payload to HTTP 404 TRANSACTION_NOT_FOUND
    if (!tx || !tx.hash) {
      this.logger.debug(`Transaction data absent in Blockchair response for ${normalizedHash}`);
      throw new ApiException(
        'TRANSACTION_NOT_FOUND',
        'The transaction hash does not exist or has not been confirmed on the chosen chain.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Determine normalized transaction status
    let status: 'confirmed' | 'failed' | 'pending' = 'confirmed';
    if (tx.failed === true || tx.status === 0 || tx.status === 'failed') {
      status = 'failed';
    } else if (!tx.block_id || tx.block_id <= 0) {
      status = 'pending';
    }

    // Normalize timestamp to ISO string
    let timestampIso: string;
    try {
      const parsedTime = new Date(
        tx.time.endsWith('Z') ? tx.time : `${tx.time.replace(' ', 'T')}Z`,
      );
      timestampIso = Number.isNaN(parsedTime.getTime())
        ? new Date().toISOString()
        : parsedTime.toISOString();
    } catch {
      timestampIso = new Date().toISOString();
    }

    const nativeSymbol = getNativeSymbol(chain);
    const explorerUrl = getExplorerUrl(chain, tx.hash);

    return {
      transactionHash: tx.hash.toLowerCase(),
      chain: chain.toLowerCase(),
      status,
      from: tx.sender.toLowerCase(),
      to: tx.recipient ? tx.recipient.toLowerCase() : null,
      value: {
        raw: String(tx.value ?? '0'),
        formatted: formatUnits(tx.value ?? '0', 18),
        symbol: nativeSymbol,
      },
      fee: {
        raw: String(tx.fee ?? '0'),
        formatted: formatUnits(tx.fee ?? '0', 18),
        symbol: nativeSymbol,
      },
      blockNumber: String(tx.block_id ?? '0'),
      timestamp: timestampIso,
      explorerUrl,
    };
  }
}
