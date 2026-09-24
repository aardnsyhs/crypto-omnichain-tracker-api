import { Module } from '@nestjs/common';
import { CoinGeckoClient } from './coingecko.client';

@Module({
  providers: [CoinGeckoClient],
  exports: [CoinGeckoClient],
})
export class CoinGeckoModule {}
