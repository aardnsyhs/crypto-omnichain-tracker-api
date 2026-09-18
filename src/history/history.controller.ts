import { Controller, Get, Query } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { HistoryService } from './history.service';
import type { HistoryListResponse } from './dto/history-response.dto';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  async getHistory(
    @CurrentSession() session?: UserSession,
    @Query('limit') limit?: string,
  ): Promise<HistoryListResponse> {
    if (!session) {
      return {
        data: [],
        meta: {
          total: 0,
          sessionId: '',
        },
      };
    }

    const parsedLimit = limit ? Number.parseInt(limit, 10) : 20;
    const records = await this.historyService.getSessionHistory(
      session.id,
      Number.isNaN(parsedLimit) ? 20 : parsedLimit,
    );

    return {
      data: records.map((record) => ({
        id: record.id,
        transactionHash: record.transactionHash,
        chain: record.chain,
        outcome: record.outcome,
        cacheHit: record.cacheHit,
        searchedAt: record.searchedAt.toISOString(),
      })),
      meta: {
        total: records.length,
        sessionId: session.sessionId,
      },
    };
  }
}
