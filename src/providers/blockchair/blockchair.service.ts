import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';
import { formatUnits, getExplorerUrl, getNativeSymbol } from '../../common/utils/evm.utils';
import { getNetworkConfig, getExplorerUrlForChain } from '../../common/constants/network-registry';
import { BlockchairClient } from './blockchair.client';
import type {
  NormalizedTransaction,
  NormalizedUtxoInput,
  NormalizedUtxoOutput,
  NormalizedUtxoTransaction,
  ProviderResult,
  RawBlockchairResponse,
  RawBlockchairUtxoDashboardResponse,
  UtxoProviderResult,
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
   * Looks up and normalizes a UTXO transaction from Blockchair.
   * Supports Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, and Dash.
   */
  async getUtxoTransaction(chain: string, transactionHash: string): Promise<UtxoProviderResult> {
    const rawResult = await this.client.fetchUtxoTransaction(chain, transactionHash);
    const normalized = this.normalizeUtxoResponse(chain, transactionHash, rawResult.data);

    return {
      transaction: normalized,
      upstreamStatusCode: rawResult.statusCode,
      providerDurationMs: rawResult.durationMs,
    };
  }

  /**
   * Pure normalization method for converting raw Blockchair payload into internal EVM transaction DTO.
   */
  normalizeResponse(
    chain: string,
    transactionHash: string,
    raw: RawBlockchairResponse,
  ): NormalizedTransaction {
    const normalizedHash = transactionHash.toLowerCase();
    const dataDict = raw?.data;

    // Check for explicit error code in context or empty data dictionary
    if (
      raw?.context?.code === 404 ||
      !dataDict ||
      typeof dataDict !== 'object' ||
      Array.isArray(dataDict)
    ) {
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

  /**
   * Pure normalization method for converting raw Blockchair UTXO payload into normalized UTXO transaction.
   * Handles multi-input, multi-output, coinbase, addressless outputs, and exact decimal conversions.
   */
  normalizeUtxoResponse(
    chain: string,
    transactionHash: string,
    raw: RawBlockchairUtxoDashboardResponse,
  ): NormalizedUtxoTransaction {
    const normalizedHash = transactionHash.toLowerCase();
    const dataDict = raw?.data;

    if (
      raw?.context?.code === 404 ||
      !dataDict ||
      typeof dataDict !== 'object' ||
      Array.isArray(dataDict)
    ) {
      throw new ApiException(
        'TRANSACTION_NOT_FOUND',
        'The transaction hash does not exist or has not been confirmed on the chosen chain.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Look for entry matching the hash
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
    if (!tx || !tx.hash) {
      this.logger.debug(`UTXO transaction data absent in Blockchair response for ${normalizedHash}`);
      throw new ApiException(
        'TRANSACTION_NOT_FOUND',
        'The transaction hash does not exist or has not been confirmed on the chosen chain.',
        HttpStatus.NOT_FOUND,
      );
    }

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

    // Network config and decimals (all UTXO targets use 8 decimals)
    const config = getNetworkConfig(chain);
    const nativeSymbol = config.nativeSymbol;
    const decimals = config.decimals;

    // Determine status & confirmations
    const currentState = raw?.context?.state;
    const blockId = tx.block_id;
    let status: 'confirmed' | 'failed' | 'pending' | 'unknown';
    let confirmations: number;

    if (blockId !== null && blockId !== undefined && blockId > 0) {
      status = 'confirmed';
      if (typeof currentState === 'number' && currentState >= blockId) {
        confirmations = currentState - blockId + 1;
      } else {
        confirmations = 1;
      }
    } else {
      status = 'pending';
      confirmations = 0;
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

    const isCoinbase = Boolean(tx.is_coinbase);
    const rawInputs = entry?.inputs || [];
    const rawOutputs = entry?.outputs || [];

    // Normalize inputs
    const normalizedInputs: NormalizedUtxoInput[] = rawInputs.map((inp, idx) => {
      const valRaw = String(inp.value ?? '0');
      return {
        index: inp.index ?? idx,
        transactionHash: inp.transaction_hash ? inp.transaction_hash.toLowerCase() : null,
        outputIndex: inp.index ?? null,
        value: {
          raw: valRaw,
          formatted: formatUnits(valRaw, decimals),
          symbol: nativeSymbol,
        },
        address: inp.recipient ? inp.recipient.trim() : null,
        type: inp.type || null,
        isCoinbase: Boolean(inp.is_from_coinbase),
        scriptHex: inp.script_hex || null,
      };
    });

    // Normalize outputs
    const normalizedOutputs: NormalizedUtxoOutput[] = rawOutputs.map((out, idx) => {
      const valRaw = String(out.value ?? '0');
      return {
        index: out.index ?? idx,
        value: {
          raw: valRaw,
          formatted: formatUnits(valRaw, decimals),
          symbol: nativeSymbol,
        },
        address: out.recipient ? out.recipient.trim() : null,
        type: out.type || null,
        isSpent: out.is_spent ?? null,
        scriptHex: out.script_hex || null,
      };
    });

    // Check truncation
    const inputCount = tx.input_count ?? normalizedInputs.length;
    const outputCount = tx.output_count ?? normalizedOutputs.length;
    const inputsTruncated = normalizedInputs.length < inputCount;
    const outputsTruncated = normalizedOutputs.length < outputCount;

    // Totals and fee
    const feeRaw = String(tx.fee ?? '0');
    const inputTotalRaw = String(tx.input_total ?? '0');
    const outputTotalRaw = String(tx.output_total ?? '0');

    // Virtual size calculation
    const size = tx.size ?? 0;
    const weight = tx.weight ?? undefined;
    const vsize = weight ? Math.ceil(weight / 4) : size || undefined;

    // Fee rate per byte
    let feePerByte: string | null = null;
    if (size > 0 && BigInt(feeRaw) >= 0n) {
      const rate = Number(BigInt(feeRaw)) / size;
      feePerByte = rate % 1 === 0 ? String(rate) : rate.toFixed(2);
    }

    const explorerUrl = getExplorerUrlForChain(chain, tx.hash);

    return {
      transactionHash: tx.hash.toLowerCase(),
      chain: chain.toLowerCase(),
      status,
      blockNumber: String(blockId ?? '0'),
      timestamp: timestampIso,
      confirmations,
      explorerUrl,
      fee: {
        raw: feeRaw,
        formatted: formatUnits(feeRaw, decimals),
        symbol: nativeSymbol,
      },
      size,
      weight,
      vsize,
      isCoinbase,
      inputCount,
      outputCount,
      inputTotal: {
        raw: inputTotalRaw,
        formatted: formatUnits(inputTotalRaw, decimals),
        symbol: nativeSymbol,
      },
      outputTotal: {
        raw: outputTotalRaw,
        formatted: formatUnits(outputTotalRaw, decimals),
        symbol: nativeSymbol,
      },
      feePerByte,
      inputsTruncated,
      outputsTruncated,
      inputs: normalizedInputs,
      outputs: normalizedOutputs,
    };
  }
}
