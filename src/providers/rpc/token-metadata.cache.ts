import { Injectable, Logger } from '@nestjs/common';
import { METADATA_CACHE_MAX_ENTRIES, METADATA_CACHE_TTL_MS } from './evm-rpc.constants';
import type { TokenMetadata } from './evm-rpc.interface';

interface CacheEntry {
  data: TokenMetadata;
  expiresAt: number;
}

@Injectable()
export class TokenMetadataCache {
  private readonly logger = new Logger(TokenMetadataCache.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<TokenMetadata>>();

  private buildKey(chain: string, contractAddress: string): string {
    return `${chain.toLowerCase()}:${contractAddress.toLowerCase()}`;
  }

  get(chain: string, contractAddress: string): TokenMetadata | null {
    const key = this.buildKey(chain, contractAddress);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  set(chain: string, contractAddress: string, data: TokenMetadata): void {
    const key = this.buildKey(chain, contractAddress);

    // If metadata retrieval was degraded on any field due to RPC/network failure,
    // only cache for degraded TTL (60s) to allow recovery after temporary RPC degradation.
    const isDegraded = data.isDegraded || (data.decimals === null && data.symbol === null);
    const ttlMs = isDegraded ? 60 * 1000 : METADATA_CACHE_TTL_MS;

    // Enforce max entries limit (evict oldest)
    if (this.cache.size >= METADATA_CACHE_MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Executes or shares an in-flight promise for the same token, preventing duplicate upstream RPC calls.
   */
  async deduplicate(
    chain: string,
    contractAddress: string,
    fetchFn: () => Promise<TokenMetadata>,
  ): Promise<TokenMetadata> {
    const cached = this.get(chain, contractAddress);
    if (cached) {
      return cached;
    }

    const key = this.buildKey(chain, contractAddress);
    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      try {
        const metadata = await fetchFn();
        this.set(chain, contractAddress, metadata);
        return metadata;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}
