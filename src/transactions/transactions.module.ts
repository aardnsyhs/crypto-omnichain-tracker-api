import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { BlockchairModule } from '../providers/blockchair/blockchair.module';
import { HistoryModule } from '../history/history.module';
import { EvmRpcModule } from '../providers/rpc/evm-rpc.module';
import { StoryModule } from './story/story.module';

@Module({
  imports: [BlockchairModule, HistoryModule, EvmRpcModule, StoryModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
