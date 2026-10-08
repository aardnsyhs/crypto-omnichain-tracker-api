import { Controller, Get, HttpCode } from '@nestjs/common';

@Controller('session')
export class SessionController {
  @Get()
  @HttpCode(204)
  initialize(): void {}
}
