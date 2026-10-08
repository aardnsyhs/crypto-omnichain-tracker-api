import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { OverviewService } from './overview.service';
import { Throttle } from '@nestjs/throttler';
import type { OverviewResponse } from './overview.interface';

@Controller('overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  @Throttle({ default: { limit: Number(process.env.OVERVIEW_THROTTLE_LIMIT || 60), ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async getOverview(): Promise<OverviewResponse> {
    return this.overviewService.getOverview();
  }
}
