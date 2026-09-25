import { Injectable } from '@nestjs/common';
import type { NormalizedTransaction } from '../../providers/blockchair/blockchair.interface';
import type { RpcEnrichmentData } from '../../providers/rpc/evm-rpc.interface';
import { EvmLogDecoder } from './evm-log.decoder';
import type {
  ActionStory,
  CoverageReason,
  StoryCoverage,
  TransactionStoryResult,
} from './story.types';

@Injectable()
export class StoryGeneratorService {
  constructor(private readonly decoder: EvmLogDecoder) {}

  generateStory(
    baseTx: NormalizedTransaction,
    enrichment: RpcEnrichmentData,
    resolvedStatus: 'confirmed' | 'failed' | 'pending' | 'unknown',
    hasDiscrepancy = false,
  ): TransactionStoryResult {
    const decoded = this.decoder.decodeLogs(enrichment.logs, enrichment.tokenMetadataMap);

    const actions: ActionStory[] = [];
    const coverageReasons: CoverageReason[] = [];

    const hasNativeValue =
      baseTx.value && baseTx.value.raw && baseTx.value.raw !== '0' && baseTx.value.raw !== '0x0';

    const hasContractInput = Boolean(enrichment.inputData && enrichment.inputData !== '0x');

    // Definite contract target requires explicit proof:
    // 1. Contract creation (!baseTx.to)
    // 2. Receipt emitted logs (only contracts can emit EVM event logs)
    // 3. Bytecode probe confirmed target is a contract (toIsContract === true)
    const isContractTarget =
      !baseTx.to || enrichment.logs.length > 0 || enrichment.toIsContract === true;

    // 1. Native Value Action
    if (hasNativeValue) {
      if (!baseTx.to) {
        actions.push({
          type: 'contract_interaction',
          description: `Contract creation with ${baseTx.value.formatted} ${baseTx.value.symbol} attached`,
          actor: baseTx.from,
          recipient: null,
          asset: {
            type: 'native',
            symbol: baseTx.value.symbol,
            contractAddress: null,
            rawAmount: baseTx.value.raw,
            formattedAmount: baseTx.value.formatted,
            decimals: 18,
          },
          proof: {
            source: 'native_value',
            contractAddress: null,
            logIndex: null,
          },
        });
      } else if (isContractTarget) {
        // Contract confirmed by bytecode or emitted logs
        actions.push({
          type: 'contract_interaction',
          description: `Contract interaction with ${baseTx.value.formatted} ${baseTx.value.symbol} sent to ${baseTx.to}`,
          actor: baseTx.from,
          recipient: baseTx.to,
          asset: {
            type: 'native',
            symbol: baseTx.value.symbol,
            contractAddress: null,
            rawAmount: baseTx.value.raw,
            formattedAmount: baseTx.value.formatted,
            decimals: 18,
          },
          proof: {
            source: 'native_value',
            contractAddress: null,
            logIndex: null,
          },
        });
      } else {
        // EOA confirmed or insufficient evidence: use neutral transfer narrative
        actions.push({
          type: 'native_transfer',
          description: `Transferred ${baseTx.value.formatted} ${baseTx.value.symbol} to ${baseTx.to}`,
          actor: baseTx.from,
          recipient: baseTx.to,
          asset: {
            type: 'native',
            symbol: baseTx.value.symbol,
            contractAddress: null,
            rawAmount: baseTx.value.raw,
            formattedAmount: baseTx.value.formatted,
            decimals: 18,
          },
          proof: {
            source: 'native_value',
            contractAddress: null,
            logIndex: null,
          },
        });
      }
    }

    // 2. Token Transfer Actions
    for (const transfer of decoded.tokenTransfers) {
      const tokenLabel =
        transfer.symbol ||
        `Token (${transfer.tokenAddress.slice(0, 6)}...${transfer.tokenAddress.slice(-4)})`;
      const amountLabel =
        transfer.formattedAmount !== null
          ? `${transfer.formattedAmount} ${tokenLabel}`
          : `${transfer.rawAmount} (raw units) ${tokenLabel}`;

      actions.push({
        type: 'token_transfer',
        description: `Transferred ${amountLabel} from ${transfer.from} to ${transfer.to}`,
        actor: transfer.from,
        recipient: transfer.to,
        asset: {
          type: 'erc20',
          symbol: transfer.symbol,
          contractAddress: transfer.tokenAddress,
          rawAmount: transfer.rawAmount,
          formattedAmount: transfer.formattedAmount,
          decimals: transfer.decimals,
        },
        proof: {
          source: 'receipt_log',
          contractAddress: transfer.tokenAddress,
          logIndex: transfer.logIndex,
        },
      });
    }

    // 3. Approval Actions
    for (const approval of decoded.approvals) {
      const tokenLabel =
        approval.symbol ||
        `Token (${approval.tokenAddress.slice(0, 6)}...${approval.tokenAddress.slice(-4)})`;

      let desc: string;
      if (approval.isRevocation) {
        desc = `Revoked ${tokenLabel} allowance for spender ${approval.spender}`;
      } else if (approval.isUnlimited) {
        desc = `Granted maximum allowance of ${tokenLabel} to spender ${approval.spender}`;
      } else {
        const amountLabel =
          approval.formattedAmount !== null
            ? `${approval.formattedAmount} ${tokenLabel}`
            : `${approval.rawAmount} (raw units) ${tokenLabel}`;
        desc = `Approved spender ${approval.spender} for ${amountLabel}`;
      }

      actions.push({
        type: 'token_approval',
        description: desc,
        actor: approval.owner,
        recipient: approval.spender,
        asset: {
          type: 'erc20',
          symbol: approval.symbol,
          contractAddress: approval.tokenAddress,
          rawAmount: approval.rawAmount,
          formattedAmount: approval.formattedAmount,
          decimals: approval.decimals,
        },
        proof: {
          source: 'receipt_log',
          contractAddress: approval.tokenAddress,
          logIndex: approval.logIndex,
        },
      });
    }

    // 4. Contract interaction fallback action if no actions were recognized but calldata or contract exists
    if (actions.length === 0 && (hasContractInput || isContractTarget)) {
      let description: string;
      if (isContractTarget) {
        description = `Contract interaction with ${baseTx.to || 'contract'} (method calldata not recognized by supported decoders)`;
      } else if (enrichment.toIsContract === false) {
        description = `Transaction to ${baseTx.to} with attached data (not recognized by supported decoders)`;
      } else {
        description = `Call to ${baseTx.to || 'recipient'} with unrecognized calldata`;
      }

      actions.push({
        type: 'contract_interaction',
        description,
        actor: baseTx.from,
        recipient: baseTx.to,
        proof: {
          source: 'calldata_input',
          contractAddress: baseTx.to,
          logIndex: null,
        },
      });
    }

    // 5. Evaluate Coverage Reasons
    if (hasDiscrepancy) {
      coverageReasons.push('provider_discrepancy');
    }
    const hasDegradedTokenMetadata = Array.from(enrichment.tokenMetadataMap.values()).some(
      (m) => m.isDegraded,
    );
    if (enrichment.temporaryFailure || hasDegradedTokenMetadata) {
      if (!coverageReasons.includes('temporary_enrichment_failure')) {
        coverageReasons.push('temporary_enrichment_failure');
      }
    }
    if (!enrichment.receipt && resolvedStatus !== 'pending') {
      coverageReasons.push('receipt_unavailable');
    }

    const hasMissingMetadata =
      decoded.tokenTransfers.some((t) => t.decimals === null) ||
      decoded.approvals.some((a) => a.decimals === null);
    if (hasMissingMetadata) {
      if (!coverageReasons.includes('metadata_unavailable')) {
        coverageReasons.push('metadata_unavailable');
      }
    }

    if (decoded.unrecognizedLogsCount > 0 || decoded.hasNftEvents) {
      coverageReasons.push('unsupported_call');
    }

    if (isContractTarget || hasContractInput) {
      coverageReasons.push('trace_not_available');
    }

    // 6. Calculate Coverage Level
    let coverage: StoryCoverage = 'complete';
    if (enrichment.temporaryFailure || hasDiscrepancy) {
      coverage = 'partial';
    } else if (
      actions.every((a) => a.type === 'contract_interaction') &&
      decoded.tokenTransfers.length === 0 &&
      decoded.approvals.length === 0
    ) {
      coverage = 'unsupported';
    } else if (
      coverageReasons.includes('unsupported_call') ||
      coverageReasons.includes('metadata_unavailable') ||
      coverageReasons.includes('receipt_unavailable')
    ) {
      coverage = 'partial';
    }

    // 7. Deterministic Narrative Explanation
    let explanation: string;

    if (resolvedStatus === 'failed') {
      explanation =
        'Transaction failed (execution reverted on blockchain). No assets were transferred or allowances updated, although network fees were consumed.';
    } else if (resolvedStatus === 'pending') {
      explanation =
        'Transaction is currently pending inclusion on-chain. Actions and asset transfers have not yet been confirmed.';
    } else if (resolvedStatus === 'unknown') {
      explanation =
        'Transaction execution status is undetermined due to conflicting provider observations or unconfirmed state.';
    } else {
      // Confirmed status
      const narrativeParts: string[] = [];

      // Native transfer
      const nativeAction = actions.find((a) => a.type === 'native_transfer');
      if (nativeAction) {
        narrativeParts.push(
          `Transferred ${baseTx.value.formatted} ${baseTx.value.symbol} from ${this.shorten(baseTx.from)} to ${this.shorten(baseTx.to || '')}`,
        );
      }

      // Token transfers
      if (decoded.tokenTransfers.length > 0) {
        const transferSummaries = decoded.tokenTransfers.map((t) => {
          const sym = t.symbol || 'tokens';
          const amt = t.formattedAmount !== null ? t.formattedAmount : `${t.rawAmount} raw units`;
          return `${amt} ${sym} to ${this.shorten(t.to)}`;
        });
        narrativeParts.push(`Transferred ${transferSummaries.join(', ')}`);
      }

      // Approvals
      if (decoded.approvals.length > 0) {
        const approvalSummaries = decoded.approvals.map((a) => {
          const sym = a.symbol || 'token';
          if (a.isRevocation) {
            return `revoked ${sym} allowance for ${this.shorten(a.spender)}`;
          }
          if (a.isUnlimited) {
            return `granted maximum ${sym} allowance to ${this.shorten(a.spender)} (historical action on this transaction)`;
          }
          const amt = a.formattedAmount !== null ? a.formattedAmount : `${a.rawAmount} raw units`;
          return `approved ${amt} ${sym} for ${this.shorten(a.spender)} (historical action on this transaction)`;
        });
        narrativeParts.push(approvalSummaries.join(' and '));
      }

      // Contract interaction without recognized token movements
      if (narrativeParts.length === 0) {
        if (hasNativeValue && isContractTarget) {
          narrativeParts.push(
            `Interacted with contract ${this.shorten(baseTx.to || '')} with ${baseTx.value.formatted} ${baseTx.value.symbol} attached`,
          );
        } else if (baseTx.to) {
          if (isContractTarget) {
            narrativeParts.push(`Executed contract interaction with ${this.shorten(baseTx.to)}`);
          } else if (enrichment.toIsContract === false) {
            narrativeParts.push(
              `Executed transaction to ${this.shorten(baseTx.to)} with attached data`,
            );
          } else {
            narrativeParts.push(`Executed call to ${this.shorten(baseTx.to)} with calldata`);
          }
        } else {
          narrativeParts.push('Executed transaction on-chain');
        }
      }

      explanation = narrativeParts.join('; ') + '.';
    }

    return {
      explanation,
      coverage,
      coverageReasons,
      actions,
      tokenTransfers: decoded.tokenTransfers,
      approvals: decoded.approvals,
    };
  }

  private shorten(addr: string): string {
    if (!addr || addr.length < 10) return addr || '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }
}
