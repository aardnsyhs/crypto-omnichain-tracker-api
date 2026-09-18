import type { UserSession } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      userSession?: UserSession;
      sessionId?: string;
    }
  }
}
