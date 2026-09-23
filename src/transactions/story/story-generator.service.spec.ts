import { StoryGeneratorService } from './story-generator.service';
import { EvmLogDecoder } from './evm-log.decoder';
import type { NormalizedTransaction } from '../../providers/blockchair/blockchair.interface';
import type { RpcEnrichmentData } from '../../providers/rpc/evm-rpc.interface';

describe('StoryGeneratorService', () => {
  let service: StoryGeneratorService;
  let decoder: EvmLogDecoder;

  beforeEach(() => {
    decoder = new EvmLogDecoder();
    service = new StoryGeneratorService(decoder);
  });

  const baseTxFixture: NormalizedTransaction = {
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    chain: 'ethereum',
    status: 'confirmed',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: {
      raw: '1000000000000000000',
      formatted: '1',
      symbol: 'ETH',
    },
    fee: {
      raw: '21000000000000',
      formatted: '0.000021',
      symbol: 'ETH',
    },
    blockNumber: '1000',
    timestamp: '2026-09-01T12:00:00Z',
    explorerUrl: 'https://etherscan.io/tx/0x123',
  };

  const emptyEnrichment: RpcEnrichmentData = {
    receipt: null,
    transaction: null,
    inputData: null,
    gasUsed: null,
    status: 'unknown',
    logs: [],
    tokenMetadataMap: new Map(),
    temporaryFailure: false,
  };

  it('generates truthful narrative for failed transactions without claiming transfers succeeded', () => {
    const result = service.generateStory(baseTxFixture, emptyEnrichment, 'failed');

    expect(result.explanation).toContain('Transaction failed (execution reverted on blockchain)');
    expect(result.explanation).toContain('No assets were transferred or allowances updated');
  });

  it('generates unconfirmed narrative for pending transactions', () => {
    const result = service.generateStory(baseTxFixture, emptyEnrichment, 'pending');

    expect(result.explanation).toContain('currently pending inclusion on-chain');
    expect(result.explanation).toContain('have not yet been confirmed');
  });

  it('generates undetermined narrative when status is unknown or provider discrepancy exists', () => {
    const result = service.generateStory(
      baseTxFixture,
      emptyEnrichment,
      'unknown',
      true, // hasDiscrepancy
    );

    expect(result.explanation).toContain('undetermined due to conflicting provider observations');
    expect(result.coverageReasons).toContain('provider_discrepancy');
    expect(result.coverage).toBe('partial');
  });

  it('generates contract interaction narrative when target is proven contract', () => {
    const enrichmentContract: RpcEnrichmentData = {
      ...emptyEnrichment,
      inputData: '0x1234abcd',
      toIsContract: true,
    };

    const result = service.generateStory(baseTxFixture, enrichmentContract, 'confirmed');

    const contractAction = result.actions.find((a) => a.type === 'contract_interaction');
    expect(contractAction).toBeDefined();
    expect(contractAction?.description).toContain('Contract interaction with 1 ETH');
  });

  it('generates neutral narrative for native value transfer when contract is unproven or target is EOA', () => {
    const enrichmentNeutral: RpcEnrichmentData = {
      ...emptyEnrichment,
      inputData: '0x1234abcd', // calldata present but toIsContract is false (e.g. data to EOA)
      toIsContract: false,
    };

    const result = service.generateStory(baseTxFixture, enrichmentNeutral, 'confirmed');

    const nativeAction = result.actions.find((a) => a.type === 'native_transfer');
    expect(nativeAction).toBeDefined();
    expect(nativeAction?.description).toBe('Transferred 1 ETH to 0x2222222222222222222222222222222222222222');
    expect(result.explanation).toContain('Transferred 1 ETH from 0x1111...1111 to 0x2222...2222');
  });

  it('identifies unsupported contract interaction when no logs or methods are recognized', () => {
    const contractTx: NormalizedTransaction = {
      ...baseTxFixture,
      value: { raw: '0', formatted: '0', symbol: 'ETH' },
    };

    const enrichment: RpcEnrichmentData = {
      ...emptyEnrichment,
      inputData: '0x99999999', // unrecognized method
    };

    const result = service.generateStory(contractTx, enrichment, 'confirmed');

    expect(result.coverage).toBe('unsupported');
    expect(result.coverageReasons).toContain('trace_not_available');
  });
});
