import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import type { Request } from 'express';

export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserSession | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.userSession;
  },
);
