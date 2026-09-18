import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionMiddleware } from './session.middleware';

@Module({
  providers: [SessionService, SessionMiddleware],
  exports: [SessionService, SessionMiddleware],
})
export class SessionModule {}
