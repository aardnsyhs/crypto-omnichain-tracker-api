import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService, LivenessResponse, ReadinessResponse } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  getLive(): LivenessResponse {
    return this.healthService.getLiveStatus();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  getReady(): ReadinessResponse {
    return this.healthService.getReadyStatus();
  }
}
