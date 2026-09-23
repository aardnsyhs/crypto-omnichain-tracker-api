import { Module } from '@nestjs/common';
import { EvmLogDecoder } from './evm-log.decoder';
import { StoryGeneratorService } from './story-generator.service';

@Module({
  providers: [EvmLogDecoder, StoryGeneratorService],
  exports: [StoryGeneratorService, EvmLogDecoder],
})
export class StoryModule {}
