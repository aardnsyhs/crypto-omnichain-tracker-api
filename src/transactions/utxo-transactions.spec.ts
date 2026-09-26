import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchairService } from '../providers/blockchair/blockchair.service';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';
import { EvmRpcService } from '../providers/rpc/evm-rpc.service';
import { StoryGeneratorService } from './story/story-generator.service';
import { HistoryService } from '../history/history.service';
import {
  ACTIVE_CHAINS,
  isUtxoChain,
  isEvmChain,
  isValidHashForChain,
  getNetworkConfig,
} from '../common/constants/network-registry';
import type { RawBlockchairUtxoDashboardResponse } from '../providers/blockchair/blockchair.interface';

describe('UTXO Multichain Expansion Suite', () => {
  describe('Network Registry & Hash Validation', () => {
    it('accurately identifies active chains and families', () => {
      expect(ACTIVE_CHAINS).toEqual([
        'ethereum',
        'bitcoin',
        'litecoin',
        'dogecoin',
        'bitcoin-cash',
        'dash',
      ]);

      expect(isEvmChain('ethereum')).toBe(true);
      expect(isEvmChain('bsc')).toBe(true);
      expect(isEvmChain('polygon')).toBe(true);

      expect(isUtxoChain('bitcoin')).toBe(true);
      expect(isUtxoChain('litecoin')).toBe(true);
      expect(isUtxoChain('dogecoin')).toBe(true);
      expect(isUtxoChain('bitcoin-cash')).toBe(true);
      expect(isUtxoChain('dash')).toBe(true);

      // Verify all 5 UTXO chains use 8 decimals and sat/byte feeUnit
      for (const chain of ['bitcoin', 'litecoin', 'dogecoin', 'bitcoin-cash', 'dash'] as const) {
        const config = getNetworkConfig(chain);
        expect(config.decimals).toBe(8);
        expect(config.feeUnit).toBe('sat/byte');
        expect(config.family).toBe('utxo');
      }
    });

    it('enforces 0x prefix for EVM and rejects 0x prefix for UTXO', () => {
      const btcHash = 'a7d3437843f32b178c8b6fd2710103f13d33b539f7ff956eb5216230b8eb7a44';
      const ethHash = '0x2784b69c2cf5944b1cc4092454e8ef7726384859eace73a647842bb31167e811';

      // Bitcoin: 64 hex without 0x is valid
      expect(isValidHashForChain('bitcoin', btcHash)).toBe(true);
      expect(isValidHashForChain('litecoin', btcHash)).toBe(true);
      expect(isValidHashForChain('dogecoin', btcHash)).toBe(true);
      expect(isValidHashForChain('bitcoin-cash', btcHash)).toBe(true);
      expect(isValidHashForChain('dash', btcHash)).toBe(true);

      // Bitcoin: 0x-prefixed hash must be rejected
      expect(isValidHashForChain('bitcoin', `0x${btcHash}`)).toBe(false);
      expect(isValidHashForChain('bitcoin', 'invalid-hash')).toBe(false);

      // Ethereum: 0x-prefixed hash is required
      expect(isValidHashForChain('ethereum', ethHash)).toBe(true);
      expect(isValidHashForChain('ethereum', btcHash)).toBe(false); // missing 0x
    });
  });

  describe('BlockchairService UTXO Normalization', () => {
    let blockchairService: BlockchairService;
    let mockClient: jest.Mocked<Pick<BlockchairClient, 'fetchUtxoTransaction' | 'fetchTransaction'>>;

    beforeEach(async () => {
      mockClient = {
        fetchUtxoTransaction: jest.fn() as any,
        fetchTransaction: jest.fn() as any,
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BlockchairService,
          { provide: BlockchairClient, useValue: mockClient },
        ],
      }).compile();

      blockchairService = module.get<BlockchairService>(BlockchairService);
    });

    it('normalizes multi-input multi-output Bitcoin transaction with exact BigInt precision', () => {
      const txHash = 'a7d3437843f32b178c8b6fd2710103f13d33b539f7ff956eb5216230b8eb7a44';
      const rawPayload: RawBlockchairUtxoDashboardResponse = {
        context: {
          code: 200,
          state: 968675, // current height
          market_price_usd: 84128,
        },
        data: {
          [txHash]: {
            transaction: {
              block_id: 968673,
              hash: txHash,
              date: '2026-09-26',
              time: '2026-09-26 10:33:41',
              size: 222,
              weight: 888,
              is_coinbase: false,
              input_count: 1,
              output_count: 2,
              input_total: '84616600', // 0.84616600 BTC
              output_total: '84605400', // 0.84605400 BTC
              fee: '11200', // 0.00011200 BTC
            },
            inputs: [
              {
                index: 0,
                transaction_hash: 'f43193d13fd74333382cced28173788d0daf2243376d679fef1455f83601d7cd',
                value: '84616600',
                recipient: '15cRpJLMRkLu5Dy6VpLkUpy4TkthYYjZLT',
                is_from_coinbase: false,
              },
            ],
            outputs: [
              {
                index: 0,
                value: '300000', // 0.003 BTC
                recipient: 'bc1qfrc8jxddpk0aq96wxtdll6nj9ur3l4lxdc37sz',
                is_spent: false,
              },
              {
                index: 1,
                value: '84305400', // 0.843054 BTC
                recipient: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
                is_spent: true,
              },
            ],
          },
        },
      };

      const result = blockchairService.normalizeUtxoResponse('bitcoin', txHash, rawPayload);

      expect(result.chain).toBe('bitcoin');
      expect(result.status).toBe('confirmed');
      expect(result.confirmations).toBe(3); // 968675 - 968673 + 1 = 3
      expect(result.isCoinbase).toBe(false);

      // Exact precision checks
      expect(result.fee.raw).toBe('11200');
      expect(result.fee.formatted).toBe('0.000112');
      expect(result.fee.symbol).toBe('BTC');

      expect(result.inputTotal.formatted).toBe('0.846166');
      expect(result.outputTotal.formatted).toBe('0.846054');

      // Vsize and fee rate
      expect(result.size).toBe(222);
      expect(result.vsize).toBe(222); // 888 / 4 = 222
      expect(result.feePerByte).toBe('50.45'); // 11200 / 222 = 50.4504...

      // Truncation flags
      expect(result.inputsTruncated).toBe(false);
      expect(result.outputsTruncated).toBe(false);

      // Inputs and outputs checks
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0].address).toBe('15cRpJLMRkLu5Dy6VpLkUpy4TkthYYjZLT');
      expect(result.inputs[0].value.formatted).toBe('0.846166');

      expect(result.outputs).toHaveLength(2);
      expect(result.outputs[0].address).toBe('bc1qfrc8jxddpk0aq96wxtdll6nj9ur3l4lxdc37sz');
      expect(result.outputs[0].value.formatted).toBe('0.003');
      expect(result.outputs[1].isSpent).toBe(true);
    });

    it('handles coinbase transaction with empty inputs without crashing', () => {
      const coinbaseHash = '8cad23c01a0c68745fbe02141cb425ad6fdc79b303d9f678e6c97f5d275eafdd';
      const rawPayload: RawBlockchairUtxoDashboardResponse = {
        context: { state: 968673 },
        data: {
          [coinbaseHash]: {
            transaction: {
              block_id: 968673,
              hash: coinbaseHash,
              size: 300,
              is_coinbase: true,
              input_count: 1,
              output_count: 1,
              input_total: '0',
              output_total: '313064769', // ~3.13 BTC block reward + fees
              fee: '0',
            },
            inputs: [], // Empty inputs in coinbase!
            outputs: [
              {
                index: 0,
                value: '313064769',
                recipient: '1BM1sAcrfV6d4zPKytzziu4McLQDsFC2Qc',
                is_from_coinbase: true,
              },
            ],
          },
        },
      };

      const result = blockchairService.normalizeUtxoResponse('bitcoin', coinbaseHash, rawPayload);

      expect(result.isCoinbase).toBe(true);
      expect(result.inputs).toHaveLength(0);
      expect(result.outputTotal.formatted).toBe('3.13064769');
      expect(result.fee.formatted).toBe('0');
      expect(result.confirmations).toBe(1);
    });

    it('handles addressless OP_RETURN output gracefully', () => {
      const txHash = '1111111111111111111111111111111111111111111111111111111111111111';
      const rawPayload: RawBlockchairUtxoDashboardResponse = {
        context: { state: 100 },
        data: {
          [txHash]: {
            transaction: {
              block_id: 100,
              hash: txHash,
              size: 150,
              fee: '1000',
              input_count: 1,
              output_count: 1,
              input_total: '10000',
              output_total: '9000',
            },
            inputs: [],
            outputs: [
              {
                index: 0,
                value: '0',
                recipient: null, // OP_RETURN has no recipient address!
                type: 'nulldata',
                script_hex: '6a1474657374',
              },
            ],
          },
        },
      };

      const result = blockchairService.normalizeUtxoResponse('bitcoin', txHash, rawPayload);
      expect(result.outputs[0].address).toBeNull();
      expect(result.outputs[0].type).toBe('nulldata');
      expect(result.outputs[0].scriptHex).toBe('6a1474657374');
    });

    it('detects partial/truncated input and output lists', () => {
      const txHash = '2222222222222222222222222222222222222222222222222222222222222222';
      const rawPayload: RawBlockchairUtxoDashboardResponse = {
        context: { state: 200 },
        data: {
          [txHash]: {
            transaction: {
              block_id: 200,
              hash: txHash,
              size: 500,
              fee: '5000',
              input_count: 10, // Provider states 10 inputs
              output_count: 20, // Provider states 20 outputs
              input_total: '100000',
              output_total: '95000',
            },
            inputs: [
              { index: 0, value: '10000', recipient: 'addr1' },
            ], // Only 1 input returned (truncated)
            outputs: [
              { index: 0, value: '95000', recipient: 'addr2' },
            ], // Only 1 output returned (truncated)
          },
        },
      };

      const result = blockchairService.normalizeUtxoResponse('bitcoin', txHash, rawPayload);
      expect(result.inputsTruncated).toBe(true);
      expect(result.outputsTruncated).toBe(true);
      expect(result.inputCount).toBe(10);
      expect(result.outputCount).toBe(20);
    });

    it('marks pending unconfirmed mempool transaction with confirmations 0', () => {
      const txHash = '3333333333333333333333333333333333333333333333333333333333333333';
      const rawPayload: RawBlockchairUtxoDashboardResponse = {
        context: { state: 500 },
        data: {
          [txHash]: {
            transaction: {
              block_id: -1, // Unconfirmed / in mempool
              hash: txHash,
              size: 200,
              fee: '2000',
              input_count: 1,
              output_count: 1,
              input_total: '10000',
              output_total: '8000',
            },
            inputs: [],
            outputs: [],
          },
        },
      };

      const result = blockchairService.normalizeUtxoResponse('dogecoin', txHash, rawPayload);
      expect(result.status).toBe('pending');
      expect(result.confirmations).toBe(0);
      expect(result.fee.symbol).toBe('DOGE');
    });
  });

  describe('TransactionsService Multichain Router & Cache Isolation', () => {
    let service: TransactionsService;
    let blockchairService: jest.Mocked<Pick<BlockchairService, 'getTransaction' | 'getUtxoTransaction'>>;
    let cacheService: jest.Mocked<Pick<CacheService, 'get' | 'set'>>;
    let prismaService: jest.Mocked<any>;
    let historyService: jest.Mocked<any>;

    const mockCacheMap = new Map<string, unknown>();

    beforeEach(async () => {
      mockCacheMap.clear();

      blockchairService = {
        getTransaction: jest.fn() as any,
        getUtxoTransaction: jest.fn() as any,
      };

      cacheService = {
        get: jest.fn<(k: string) => Promise<any>>().mockImplementation((k) =>
          Promise.resolve(mockCacheMap.get(k) ?? null),
        ) as any,
        set: jest.fn<(k: string, v: any) => Promise<boolean>>().mockImplementation((k, v) => {
          mockCacheMap.set(k, v);
          return Promise.resolve(true);
        }) as any,
      };

      prismaService = {
        apiRequestLog: {
          create: jest.fn().mockResolvedValue({ id: 'log-1' } as never),
        },
      };

      historyService = {
        recordSearch: jest.fn().mockResolvedValue({ id: 'hist-1' } as never),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TransactionsService,
          { provide: BlockchairService, useValue: blockchairService },
          { provide: CacheService, useValue: cacheService },
          { provide: PrismaService, useValue: prismaService },
          { provide: HistoryService, useValue: historyService },
          {
            provide: EvmRpcService,
            useValue: {
              enrichTransaction: jest.fn(),
              createBaseTransaction: jest.fn(),
            },
          },
          {
            provide: StoryGeneratorService,
            useValue: {
              generateStory: jest.fn(),
            },
          },
        ],
      }).compile();

      service = module.get<TransactionsService>(TransactionsService);
    });

    it('routes UTXO lookup to Blockchair and isolates cache key by chain', async () => {
      const btcHash = 'a7d3437843f32b178c8b6fd2710103f13d33b539f7ff956eb5216230b8eb7a44';

      blockchairService.getUtxoTransaction.mockResolvedValueOnce({
        transaction: {
          transactionHash: btcHash,
          chain: 'bitcoin',
          status: 'confirmed',
          blockNumber: '968673',
          timestamp: '2026-09-26T10:33:41Z',
          confirmations: 5,
          explorerUrl: `https://blockchair.com/bitcoin/transaction/${btcHash}`,
          fee: { raw: '11200', formatted: '0.000112', symbol: 'BTC' },
          size: 222,
          vsize: 222,
          isCoinbase: false,
          inputCount: 1,
          outputCount: 2,
          inputTotal: { raw: '84616600', formatted: '0.846166', symbol: 'BTC' },
          outputTotal: { raw: '84605400', formatted: '0.846054', symbol: 'BTC' },
          inputsTruncated: false,
          outputsTruncated: false,
          inputs: [],
          outputs: [],
        },
        upstreamStatusCode: 200,
        providerDurationMs: 120,
      });

      const response = await service.lookupTransaction({
        chain: 'bitcoin',
        transactionHash: btcHash,
      });

      expect(response.data.family).toBe('utxo');
      expect(response.data.chain).toBe('bitcoin');
      expect(response.data.explanation).toContain('Transaction with 1 input and 2 outputs');
      expect(response.meta.cache.hit).toBe(false);

      // Verify cache key isolates chain and hash
      const expectedCacheKey = `transaction:v2:bitcoin:${btcHash}`;
      expect(cacheService.set).toHaveBeenCalledWith(expectedCacheKey, expect.anything(), 3600);

      // Subsequent call hits cache
      const cachedResponse = await service.lookupTransaction({
        chain: 'bitcoin',
        transactionHash: btcHash,
      });
      expect(cachedResponse.meta.cache.hit).toBe(true);
      expect(blockchairService.getUtxoTransaction).toHaveBeenCalledTimes(1);
    });

    it('does not cache pending UTXO transactions (TTL 0)', async () => {
      const txHash = '4444444444444444444444444444444444444444444444444444444444444444';

      blockchairService.getUtxoTransaction.mockResolvedValueOnce({
        transaction: {
          transactionHash: txHash,
          chain: 'litecoin',
          status: 'pending',
          blockNumber: '0',
          timestamp: null,
          confirmations: 0,
          explorerUrl: `https://blockchair.com/litecoin/transaction/${txHash}`,
          fee: { raw: '500', formatted: '0.000005', symbol: 'LTC' },
          size: 200,
          isCoinbase: false,
          inputCount: 1,
          outputCount: 1,
          inputTotal: { raw: '10000', formatted: '0.0001', symbol: 'LTC' },
          outputTotal: { raw: '9500', formatted: '0.000095', symbol: 'LTC' },
          inputsTruncated: false,
          outputsTruncated: false,
          inputs: [],
          outputs: [],
        },
        upstreamStatusCode: 200,
        providerDurationMs: 90,
      });

      const response = await service.lookupTransaction({
        chain: 'litecoin',
        transactionHash: txHash,
      });

      expect(response.data.status).toBe('pending');
      // TTL 0 means cacheService.set is not called with positive TTL
      expect(mockCacheMap.has(`transaction:v2:litecoin:${txHash}`)).toBe(false);
    });
  });
});
