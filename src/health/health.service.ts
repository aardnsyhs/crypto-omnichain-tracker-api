import { Injectable } from '@nestjs/common';

export interface LivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'degraded';
  checks: {
    api: 'ready';
    database: 'not_checked';
    redis: 'not_checked';
  };
  phase: 'milestone-1a';
}

@Injectable()
export class HealthService {
  private readonly startTime: number = Date.now();

  getLiveStatus(): LivenessResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  getReadyStatus(): ReadinessResponse {
    return {
      status: 'degraded',
      checks: {
        api: 'ready',
        database: 'not_checked',
        redis: 'not_checked',
      },
      phase: 'milestone-1a',
    };
  }
}
