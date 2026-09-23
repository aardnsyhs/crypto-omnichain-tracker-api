import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getTransactionCacheTtlSeconds } from './cache.constants';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: (times) => {
          if (times > 3) {
            return null; // Stop reconnecting aggressively on failure
          }
          return Math.min(times * 500, 2000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Connected to Redis cache server.');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis connection warning: ${(err as Error).message}`);
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });
    } catch (error) {
      this.logger.warn(`Failed to initialize Redis client: ${(error as Error).message}`);
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.client) {
      try {
        await this.client.connect();
      } catch (err) {
        this.logger.warn(
          `Could not connect to Redis at startup: ${(err as Error).message}. Operating in degraded bypass mode.`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  /**
   * Resiliently fetches cached JSON item. Degrades gracefully to null on any Redis error.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const data = await this.client.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as T;
    } catch (error) {
      this.logger.warn(
        `Redis GET failed for key "${key}": ${(error as Error).message}. Bypassing cache.`,
      );
      return null;
    }
  }

  /**
   * Resiliently writes JSON item to cache with TTL. Fails gracefully without throwing.
   */
  async set(
    key: string,
    value: unknown,
    ttlSeconds = getTransactionCacheTtlSeconds(),
  ): Promise<boolean> {
    if (!this.client || !this.isConnected || ttlSeconds <= 0) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized, 'EX', ttlSeconds);
      return true;
    } catch (error) {
      this.logger.warn(
        `Redis SET failed for key "${key}": ${(error as Error).message}. Continuing without cache.`,
      );
      return false;
    }
  }

  /**
   * Resiliently deletes a cached item. Fails gracefully without throwing.
   */
  async del(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      this.logger.warn(`Redis DEL failed for key "${key}": ${(error as Error).message}.`);
      return false;
    }
  }
}
