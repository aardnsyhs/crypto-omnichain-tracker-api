import { Injectable, Logger } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { getSessionTtlMs } from './session.constants';

export interface SessionResolution {
  session: UserSession;
  isNew: boolean;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a 64-character hexadecimal cryptographically secure random session token.
   */
  generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Creates a new anonymous UserSession record in PostgreSQL.
   */
  async createSession(): Promise<UserSession> {
    const sessionId = this.generateSessionId();
    const ttlMs = getSessionTtlMs();
    const expiresAt = new Date(Date.now() + ttlMs);

    const session = await this.prisma.userSession.create({
      data: {
        sessionId,
        expiresAt,
      },
    });

    this.logger.debug(`Created new anonymous user session: ${session.sessionId.slice(0, 8)}...`);
    return session;
  }

  /**
   * Validates an existing session ID.
   * Returns the UserSession if found and not expired; otherwise returns null.
   */
  async validateSession(sessionId: string): Promise<UserSession | null> {
    if (!sessionId || typeof sessionId !== 'string') {
      return null;
    }

    const session = await this.prisma.userSession.findUnique({
      where: { sessionId },
    });

    if (!session) {
      return null;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      this.logger.debug(`Session expired: ${session.sessionId.slice(0, 8)}...`);
      return null;
    }

    return session;
  }

  /**
   * Updates lastActiveAt and conditionally refreshes expiresAt if under 50% remaining TTL.
   */
  async touchSession(sessionId: string): Promise<UserSession> {
    const ttlMs = getSessionTtlMs();
    const now = Date.now();

    const current = await this.prisma.userSession.findUnique({
      where: { sessionId },
    });

    if (!current) {
      return this.createSession();
    }

    const remainingLifetime = current.expiresAt.getTime() - now;
    const shouldExtend = remainingLifetime < ttlMs / 2;
    const newExpiresAt = shouldExtend ? new Date(now + ttlMs) : current.expiresAt;

    return this.prisma.userSession.update({
      where: { sessionId },
      data: {
        lastActiveAt: new Date(now),
        expiresAt: newExpiresAt,
      },
    });
  }

  /**
   * Resolves or issues an anonymous session:
   * If candidateSessionId is valid and active, touches and returns it with isNew = false.
   * If absent or expired, issues a new session with isNew = true.
   */
  async getOrCreateSession(candidateSessionId?: string): Promise<SessionResolution> {
    if (candidateSessionId) {
      const existing = await this.validateSession(candidateSessionId);
      if (existing) {
        const touched = await this.touchSession(candidateSessionId);
        return { session: touched, isNew: false };
      }
    }

    const newSession = await this.createSession();
    return { session: newSession, isNew: true };
  }
}
