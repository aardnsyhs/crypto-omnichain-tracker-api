import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionMiddleware } from './session.middleware';
import { SessionController } from './session.controller';

@Module({
  controllers: [SessionController],
  providers: [SessionService, SessionMiddleware],
  exports: [SessionService, SessionMiddleware],
})
export class SessionModule {}
