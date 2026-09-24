import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { CoinGeckoModule } from '../providers/coingecko/coingecko.module';
import { EvmRpcModule } from '../providers/rpc/evm-rpc.module';
import { BlockchairModule } from '../providers/blockchair/blockchair.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

@Module({
  imports: [CacheModule, CoinGeckoModule, EvmRpcModule, BlockchairModule],
  controllers: [OverviewController],
  providers: [OverviewService],
  exports: [OverviewService],
})
export class OverviewModule {}
