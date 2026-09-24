import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { OverviewService } from './overview.service';
import type { OverviewResponse } from './overview.interface';

@Controller('overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getOverview(): Promise<OverviewResponse> {
    return this.overviewService.getOverview();
  }
}
