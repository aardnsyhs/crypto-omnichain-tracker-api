import { Injectable, Logger } from '@nestjs/common';
import type { SearchHistory } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { CreateHistoryDto } from './dto/create-history.dto';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a search history record scoped to a UserSession internal UUID.
   */
  async recordSearch(userSessionId: string, data: CreateHistoryDto): Promise<SearchHistory> {
    const history = await this.prisma.searchHistory.create({
      data: {
        userSessionId,
        transactionHash: data.transactionHash.toLowerCase(),
        chain: data.chain.toLowerCase(),
        outcome: data.outcome,
        txStatus: data.txStatus ?? null,
        cacheHit: data.cacheHit,
      },
    });

    this.logger.debug(
      `Recorded search history: ${data.chain}:${data.transactionHash.slice(0, 10)}... [${data.outcome}]`,
    );

    return history;
  }

  /**
   * Retrieves recent search history records scoped to a UserSession internal UUID.
   */
  async getSessionHistory(userSessionId: string, limit = 20): Promise<SearchHistory[]> {
    return this.prisma.searchHistory.findMany({
      where: { userSessionId },
      orderBy: { searchedAt: 'desc' },
      take: Math.min(Math.max(1, limit), 100),
    });
  }
}
