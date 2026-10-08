import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';

export interface LivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}
export interface ReadinessResponse {
  status: 'ready' | 'degraded' | 'unavailable';
  checks: { api: 'ready'; database: 'ready' | 'unavailable'; redis: 'ready' | 'bypassed' };
}

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();
  private inFlight: Promise<ReadinessResponse> | null = null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  getLiveStatus(): LivenessResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  async getReadyStatus(): Promise<ReadinessResponse> {
    if (!this.inFlight)
      this.inFlight = this.check().finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async bounded(check: () => Promise<boolean>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve()
          .then(check)
          .catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), Number(process.env.HEALTH_TIMEOUT_MS || 2000));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async check(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      this.bounded(() => this.prisma.isHealthy()),
      this.bounded(() => this.cache.ping()),
    ]);
    return {
      status: !database ? 'unavailable' : redis ? 'ready' : 'degraded',
      checks: {
        api: 'ready',
        database: database ? 'ready' : 'unavailable',
        redis: redis ? 'ready' : 'bypassed',
      },
    };
  }
}
