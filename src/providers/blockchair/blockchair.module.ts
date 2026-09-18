import { Module } from '@nestjs/common';
import { BlockchairClient } from './blockchair.client';
import { BlockchairService } from './blockchair.service';

@Module({
  providers: [BlockchairClient, BlockchairService],
  exports: [BlockchairService, BlockchairClient],
})
export class BlockchairModule {}
