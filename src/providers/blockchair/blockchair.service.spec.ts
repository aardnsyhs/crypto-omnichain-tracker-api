import { BlockchairClient } from './blockchair.client';
import { BlockchairService } from './blockchair.service';
import {
  ETHEREUM_SUCCESS_FIXTURE,
  ETHEREUM_SUCCESS_HASH,
} from './fixtures/ethereum-success.fixture';
import { BSC_SUCCESS_FIXTURE, BSC_SUCCESS_HASH } from './fixtures/bsc-success.fixture';
import { POLYGON_SUCCESS_FIXTURE, POLYGON_SUCCESS_HASH } from './fixtures/polygon-success.fixture';
import {
  NOT_FOUND_EMPTY_DATA_FIXTURE,
  NOT_FOUND_ERROR_CONTEXT_FIXTURE,
  NOT_FOUND_HASH,
} from './fixtures/not-found.fixture';

describe('BlockchairService Normalization', () => {
  let service: BlockchairService;
  let mockClient: BlockchairClient;

  beforeEach(() => {
    mockClient = {} as BlockchairClient;
    service = new BlockchairService(mockClient);
  });

  it('normalizes Ethereum transaction fixture correctly', () => {
    const result = service.normalizeResponse(
      'ethereum',
      ETHEREUM_SUCCESS_HASH,
      ETHEREUM_SUCCESS_FIXTURE,
    );

    expect(result.transactionHash).toBe(ETHEREUM_SUCCESS_HASH.toLowerCase());
    expect(result.chain).toBe('ethereum');
    expect(result.status).toBe('confirmed');
    expect(result.from).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.to).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    expect(result.value).toEqual({
      raw: '1500000000000000000',
      formatted: '1.5',
      symbol: 'ETH',
    });
    expect(result.fee).toEqual({
      raw: '2100000000000000',
      formatted: '0.0021',
      symbol: 'ETH',
    });
    expect(result.blockNumber).toBe('12345678');
    expect(result.explorerUrl).toBe(`https://etherscan.io/tx/${ETHEREUM_SUCCESS_HASH}`);
  });

  it('normalizes BSC transaction fixture with BNB symbol', () => {
    const result = service.normalizeResponse('bsc', BSC_SUCCESS_HASH, BSC_SUCCESS_FIXTURE);

    expect(result.transactionHash).toBe(BSC_SUCCESS_HASH.toLowerCase());
    expect(result.chain).toBe('bsc');
    expect(result.value.symbol).toBe('BNB');
    expect(result.value.formatted).toBe('0.5');
    expect(result.fee.symbol).toBe('BNB');
    expect(result.fee.formatted).toBe('0.001');
    expect(result.explorerUrl).toBe(`https://bscscan.com/tx/${BSC_SUCCESS_HASH}`);
  });

  it('normalizes Polygon transaction fixture with POL symbol', () => {
    const result = service.normalizeResponse(
      'polygon',
      POLYGON_SUCCESS_HASH,
      POLYGON_SUCCESS_FIXTURE,
    );

    expect(result.transactionHash).toBe(POLYGON_SUCCESS_HASH.toLowerCase());
    expect(result.chain).toBe('polygon');
    expect(result.value.symbol).toBe('POL');
    expect(result.value.formatted).toBe('10');
    expect(result.explorerUrl).toBe(`https://polygonscan.com/tx/${POLYGON_SUCCESS_HASH}`);
  });

  it('throws TRANSACTION_NOT_FOUND on empty data dictionary', () => {
    expect(() =>
      service.normalizeResponse('ethereum', NOT_FOUND_HASH, NOT_FOUND_EMPTY_DATA_FIXTURE),
    ).toThrowError(expect.objectContaining({ code: 'TRANSACTION_NOT_FOUND' }));
  });

  it('throws TRANSACTION_NOT_FOUND on context error 404', () => {
    expect(() =>
      service.normalizeResponse('ethereum', NOT_FOUND_HASH, NOT_FOUND_ERROR_CONTEXT_FIXTURE),
    ).toThrowError(expect.objectContaining({ code: 'TRANSACTION_NOT_FOUND' }));
  });
});
