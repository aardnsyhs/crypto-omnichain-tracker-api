import { Injectable, Logger } from '@nestjs/common';
import {
  ERC20_APPROVAL_TOPIC0,
  ERC20_TRANSFER_TOPIC0,
  MAX_UINT256_BIGINT,
} from '../../providers/rpc/evm-rpc.constants';
import type { RpcLog, TokenMetadata } from '../../providers/rpc/evm-rpc.interface';
import { formatUnits } from '../../common/utils/evm.utils';
import type { ApprovalStory, TokenTransferStory } from './story.types';

export interface DecodedLogsResult {
  tokenTransfers: TokenTransferStory[];
  approvals: ApprovalStory[];
  unrecognizedLogsCount: number;
  hasNftEvents: boolean;
}

@Injectable()
export class EvmLogDecoder {
  private readonly logger = new Logger(EvmLogDecoder.name);

  /**
   * Decodes raw RPC logs into structured ERC-20 Transfer and Approval events.
   * Differentiates ERC-20 from ERC-721 without misclassifying arbitrary 4-topic events.
   */
  decodeLogs(logs: RpcLog[], tokenMetadataMap: Map<string, TokenMetadata>): DecodedLogsResult {
    const tokenTransfers: TokenTransferStory[] = [];
    const approvals: ApprovalStory[] = [];
    let unrecognizedLogsCount = 0;
    let hasNftEvents = false;

    for (const log of logs) {
      if (!log.topics || log.topics.length === 0) {
        unrecognizedLogsCount++;
        continue;
      }

      const topic0 = log.topics[0]?.toLowerCase();

      // Check Transfer event signature
      if (topic0 === ERC20_TRANSFER_TOPIC0) {
        // Strict distinction: ERC-721 Transfer has 4 topics (indexed from, indexed to, indexed tokenId)
        if (log.topics.length === 4) {
          hasNftEvents = true;
          // Not an ERC-20 token transfer!
          continue;
        }

        // ERC-20 Transfer must have exactly 3 topics and uint256 data
        if (log.topics.length === 3 && log.data && log.data.length >= 66) {
          try {
            const tokenAddress = log.address?.toLowerCase();
            const from = this.extractAddress(log.topics[1]);
            const to = this.extractAddress(log.topics[2]);
            const rawAmount = BigInt(`0x${log.data.slice(2, 66)}`).toString(10);

            const metadata = tokenMetadataMap.get(tokenAddress);
            const decimals = metadata?.decimals ?? null;
            const symbol = metadata?.symbol ?? null;
            const name = metadata?.name ?? null;

            const formattedAmount = decimals !== null ? formatUnits(rawAmount, decimals) : null;

            tokenTransfers.push({
              tokenAddress,
              symbol,
              name,
              decimals,
              from,
              to,
              rawAmount,
              formattedAmount,
              logIndex: log.logIndex,
            });
            continue;
          } catch (err) {
            this.logger.debug(`Failed decoding ERC-20 transfer log: ${(err as Error).message}`);
          }
        }

        unrecognizedLogsCount++;
        continue;
      }

      // Check Approval event signature
      if (topic0 === ERC20_APPROVAL_TOPIC0) {
        // ERC-20 Approval has exactly 3 topics (indexed owner, indexed spender) and uint256 value in data
        if (log.topics.length === 3 && log.data && log.data.length >= 66) {
          try {
            const tokenAddress = log.address?.toLowerCase();
            const owner = this.extractAddress(log.topics[1]);
            const spender = this.extractAddress(log.topics[2]);
            const rawAmountBigInt = BigInt(`0x${log.data.slice(2, 66)}`);
            const rawAmount = rawAmountBigInt.toString(10);

            const isRevocation = rawAmount === '0';
            const isUnlimited = rawAmountBigInt === MAX_UINT256_BIGINT;

            const metadata = tokenMetadataMap.get(tokenAddress);
            const decimals = metadata?.decimals ?? null;
            const symbol = metadata?.symbol ?? null;
            const name = metadata?.name ?? null;

            let formattedAmount: string | null = null;
            if (isRevocation) {
              formattedAmount = '0';
            } else if (!isUnlimited && decimals !== null) {
              formattedAmount = formatUnits(rawAmount, decimals);
            }

            approvals.push({
              tokenAddress,
              symbol,
              name,
              decimals,
              owner,
              spender,
              rawAmount,
              formattedAmount,
              isUnlimited,
              isRevocation,
              logIndex: log.logIndex,
            });
            continue;
          } catch (err) {
            this.logger.debug(`Failed decoding ERC-20 approval log: ${(err as Error).message}`);
          }
        }

        unrecognizedLogsCount++;
        continue;
      }

      // Any other unrecognized event log
      unrecognizedLogsCount++;
    }

    return {
      tokenTransfers,
      approvals,
      unrecognizedLogsCount,
      hasNftEvents,
    };
  }

  private extractAddress(topic: string): string {
    if (!topic || topic.length < 42) return '0x';
    const clean = topic.startsWith('0x') ? topic.slice(2) : topic;
    // EVM address is in the last 20 bytes (40 hex chars)
    return `0x${clean.slice(-40).toLowerCase()}`;
  }
}
