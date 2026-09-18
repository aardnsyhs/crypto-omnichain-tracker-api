import { buildTransactionCacheKey } from './cache.constants';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  describe('buildTransactionCacheKey', () => {
    it('constructs key according to canonical specification format', () => {
      const key = buildTransactionCacheKey(
        'Ethereum',
        '0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
      );
      expect(key).toBe(
        'transaction:v1:ethereum:0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
    });

    it('handles BSC and Polygon lowercase normalization', () => {
      expect(buildTransactionCacheKey('BSC', '0xAAA')).toBe('transaction:v1:bsc:0xaaa');
      expect(buildTransactionCacheKey('POLYGON', '0xBBB')).toBe('transaction:v1:polygon:0xbbb');
    });
  });

  describe('CacheService error degradation', () => {
    let service: CacheService;

    beforeEach(() => {
      service = new CacheService();
    });

    it('returns null on get without throwing when disconnected', async () => {
      const result = await service.get('nonexistent');
      expect(result).toBeNull();
    });

    it('returns false on set without throwing when disconnected', async () => {
      const result = await service.set('test-key', { foo: 'bar' });
      expect(result).toBe(false);
    });
  });
});
