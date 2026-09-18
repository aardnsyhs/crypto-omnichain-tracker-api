import { Controller, Post, Body, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { TransactionsService } from './transactions.service';
import { TransactionLookupDto } from './dto/transaction-lookup.dto';
import type { TransactionLookupResponse } from './dto/transaction-response.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(
    @Body() dto: TransactionLookupDto,
    @CurrentSession() session?: UserSession,
    @Headers('x-request-id') requestId?: string,
  ): Promise<TransactionLookupResponse> {
    return this.transactionsService.lookupTransaction(dto, session, requestId);
  }
}
