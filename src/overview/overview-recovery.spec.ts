import { jest } from '@jest/globals';
import { OverviewService } from './overview.service';
import { CacheService } from '../cache/cache.service';
import { BlockchairClient } from '../providers/blockchair/blockchair.client';
import { ACTIVE_CHAINS } from '../common/constants/network-registry';
import type { CachedOverviewEnvelope } from './overview.interface';
import type {
  BlockchairGlobalStatsFetchResult,
  BlockchairStatsFetchResult,
} from '../providers/blockchair/blockchair.interface';

describe('overview recovery through provider result contract', () => {
  let service: OverviewService;
  let saved: CachedOverviewEnvelope | null;
  const global = jest.fn<() => Promise<BlockchairGlobalStatsFetchResult>>();
  const single = jest.fn<() => Promise<BlockchairStatsFetchResult>>();
  const set = jest.fn<(key: string, value: CachedOverviewEnvelope) => Promise<boolean>>();
  const good = () => ({
    data: Object.fromEntries(
      ACTIVE_CHAINS.map((chain) => [
        chain,
        {
          market_price_usd: 100,
          market_price_usd_change_24h_percentage: 0,
          best_block_height: 42,
          suggested_transaction_fee_per_byte_sat: 1,
        },
      ]),
    ),
    statusCode: 200,
    isRateLimited: false,
    durationMs: 1,
  });
  const bad = (code = 502) => ({
    data: null,
    statusCode: code,
    isRateLimited: [402, 429].includes(code),
    durationMs: 1,
  });
  beforeEach(() => {
    jest.useFakeTimers();
    saved = null;
    global.mockReset().mockResolvedValue(good());
    single.mockReset().mockResolvedValue(bad());
    set.mockReset().mockImplementation(async (_, value) => {
      saved = value;
      return true;
    });
    service = new OverviewService(
      { get: async () => saved, set } as unknown as CacheService,
      { fetchGlobalStats: global, fetchChainStats: single } as unknown as BlockchairClient,
    );
  });
  afterEach(() => jest.useRealTimers());
  it('preserves stale values on data:null and does not overwrite a valid cache', async () => {
    const first = await service.getOverview();
    await jest.advanceTimersByTimeAsync(61000);
    global.mockResolvedValue(bad());
    const result = await service.getOverview();
    expect(result.data[0].market).toMatchObject({
      priceUsd: 100,
      isStale: true,
      updatedAt: first.data[0].market?.updatedAt,
    });
    expect(set).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });
  it('recovers networks and fields independently without extending old timestamps', async () => {
    const first = await service.getOverview();
    await jest.advanceTimersByTimeAsync(61000);
    const partial = good();
    delete partial.data.bitcoin;
    partial.data.ethereum = { ...partial.data.ethereum, market_price_usd: 200 };
    delete (partial.data.ethereum as Partial<typeof partial.data.ethereum>)
      .market_price_usd_change_24h_percentage;
    global.mockResolvedValue(partial);
    const next = await service.getOverview();
    expect(next.data.find((v) => v.chain === 'bitcoin')?.market?.isStale).toBe(true);
    expect(next.data[0].market).toMatchObject({
      priceUsd: 200,
      change24h: 0,
      staleFields: ['change24h'],
      updatedAt: first.data[0].market?.updatedAt,
    });
    await jest.advanceTimersByTimeAsync(241000);
    const expired = await service.getOverview();
    expect(expired.data.find((v) => v.chain === 'bitcoin')?.market?.priceUsd).toBeNull();
    expect(expired.data[0].market?.change24h).toBeNull();
  });
  it.each([402, 429])('propagates quota status %s and cools down without fan-out', async (code) => {
    global.mockResolvedValue(bad(code));
    const result = await service.getOverview();
    await service.getOverview();
    expect(result.meta).toMatchObject({ isRateLimited: true, providerStatus: code });
    expect(result.data[0].market?.status).toBe('rate_limited');
    expect(global).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });
  it('drops values older than maximum age and recovers on a later success', async () => {
    await service.getOverview();
    await jest.advanceTimersByTimeAsync(301000);
    global.mockResolvedValue(bad());
    expect((await service.getOverview()).data[0].market?.priceUsd).toBeNull();
    await jest.advanceTimersByTimeAsync(16000);
    global.mockResolvedValue(good());
    expect((await service.getOverview()).data[0].market).toMatchObject({
      priceUsd: 100,
      isStale: false,
    });
  });
  it('deduplicates concurrent refreshes', async () => {
    await Promise.all(Array.from({ length: 8 }, () => service.getOverview()));
    expect(global).toHaveBeenCalledTimes(1);
  });
});
