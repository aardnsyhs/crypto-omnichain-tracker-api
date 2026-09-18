import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { SessionService } from './session.service';
import { getSessionCookieName, getSessionCookieOptions } from './session.constants';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SessionMiddleware.name);

  constructor(private readonly sessionService: SessionService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const cookieName = getSessionCookieName();
    const candidateSessionId: string | undefined =
      req.signedCookies?.[cookieName] ?? req.cookies?.[cookieName];

    try {
      const { session, isNew } = await this.sessionService.getOrCreateSession(candidateSessionId);

      req.userSession = session;
      req.sessionId = session.sessionId;

      if (isNew) {
        res.cookie(cookieName, session.sessionId, getSessionCookieOptions());
        this.logger.debug(
          `Set new signed session cookie "${cookieName}" for session ${session.sessionId.slice(0, 8)}...`,
        );
      }

      next();
    } catch (error) {
      this.logger.error(
        `Failed to resolve anonymous session: ${(error as Error).message}`,
        (error as Error).stack,
      );
      next(error);
    }
  }
}
