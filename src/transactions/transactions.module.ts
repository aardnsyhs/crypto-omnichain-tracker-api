import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { BlockchairModule } from '../providers/blockchair/blockchair.module';
import { HistoryModule } from '../history/history.module';

@Module({
  imports: [BlockchairModule, HistoryModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
