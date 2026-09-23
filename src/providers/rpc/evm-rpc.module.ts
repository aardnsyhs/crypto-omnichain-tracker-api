import { Module } from '@nestjs/common';
import { EvmRpcClient } from './evm-rpc.client';
import { TokenMetadataCache } from './token-metadata.cache';
import { EvmRpcService } from './evm-rpc.service';

@Module({
  providers: [EvmRpcClient, TokenMetadataCache, EvmRpcService],
  exports: [EvmRpcService, EvmRpcClient],
})
export class EvmRpcModule {}
