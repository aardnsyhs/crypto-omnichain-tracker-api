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
   * Performs runtime payload validation, strictly verifies response transaction hash,
   * handles invalid timestamps without defaulting to current time, and distinguishes
   * missing vs malformed data.
   */
  normalizeResponse(
    chain: string,
    transactionHash: string,
    raw: RawBlockchairResponse,
  ): NormalizedTransaction {
    const normalizedHash = transactionHash.toLowerCase();
    const dataDict = raw?.data;

    // Check for explicit error code in context or empty data dictionary
    if (raw?.context?.code === 404 || !dataDict || typeof dataDict !== 'object') {
      throw new ApiException(
        'TRANSACTION_NOT_FOUND',
        'The transaction hash does not exist or has not been confirmed on the chosen chain.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Look for entry specifically matching the requested transaction hash
    let entry = dataDict[normalizedHash] ?? dataDict[transactionHash];

    if (!entry) {
      for (const val of Object.values(dataDict)) {
        if (
          val?.transaction?.hash &&
          typeof val.transaction.hash === 'string' &&
          val.transaction.hash.toLowerCase() === normalizedHash
        ) {
          entry = val;
          break;
        }
      }
    }

    const tx = entry?.transaction;

    // If transaction data is absent for this hash -> 404
    if (!tx || !tx.hash) {
      this.logger.debug(`Transaction data absent in Blockchair response for ${normalizedHash}`);
      throw new ApiException(
        'TRANSACTION_NOT_FOUND',
        'The transaction hash does not exist or has not been confirmed on the chosen chain.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Validate that response hash matches the requested hash
    if (typeof tx.hash !== 'string' || tx.hash.toLowerCase() !== normalizedHash) {
      this.logger.warn(
        `Blockchair payload hash mismatch: expected ${normalizedHash}, got ${String(tx.hash)}`,
      );
      throw new ApiException(
        'UPSTREAM_PROVIDER_ERROR',
        'Upstream provider returned data for a different transaction hash.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Runtime validation of sender
    if (typeof tx.sender !== 'string' || !tx.sender.trim()) {
      this.logger.warn(`Blockchair payload missing valid sender for ${normalizedHash}`);
      throw new ApiException(
        'UPSTREAM_PROVIDER_ERROR',
        'Upstream provider returned malformed transaction data (missing sender).',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Determine normalized transaction status
    let status: 'confirmed' | 'failed' | 'pending' | 'unknown' = 'unknown';
    if (tx.failed === true || tx.status === 0 || tx.status === 'failed') {
      status = 'failed';
    } else if (
      tx.status === 1 ||
      tx.status === 'success' ||
      tx.has_result === true ||
      (typeof tx.block_id === 'number' && tx.block_id > 0)
    ) {
      status = 'confirmed';
    } else if (tx.block_id === null || tx.block_id === undefined || tx.block_id <= 0) {
      status = 'pending';
    }

    // Normalize timestamp to ISO string without defaulting to current time
    let timestampIso: string | null = null;
    if (tx.time && typeof tx.time === 'string' && tx.time.trim() !== '') {
      try {
        const timeStr = tx.time.trim();
        const parsedTime = new Date(
          timeStr.endsWith('Z') ? timeStr : `${timeStr.replace(' ', 'T')}Z`,
        );
        if (!Number.isNaN(parsedTime.getTime())) {
          timestampIso = parsedTime.toISOString();
        }
      } catch {
        timestampIso = null;
      }
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
