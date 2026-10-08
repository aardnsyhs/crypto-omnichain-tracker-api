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
    const signed: unknown = req.signedCookies?.[cookieName];
    const candidateSessionId =
      typeof signed === 'string' && /^[a-f0-9]{64}$/.test(signed) ? signed : undefined;

    try {
      const { session } = await this.sessionService.getOrCreateSession(candidateSessionId);

      req.userSession = session;
      req.sessionId = session.sessionId;

      res.cookie(cookieName, session.sessionId, {
        ...getSessionCookieOptions(),
        maxAge: Math.max(0, session.expiresAt.getTime() - Date.now()),
      });

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
