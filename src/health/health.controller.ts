import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService, LivenessResponse, ReadinessResponse } from './health.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  getLive(): LivenessResponse {
    return this.healthService.getLiveStatus();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async getReady(@Res({ passthrough: true }) response?: Response): Promise<ReadinessResponse> {
    const result = await this.healthService.getReadyStatus();
    response?.status(result.status === 'unavailable' ? 503 : 200);
    return result;
  }
}
