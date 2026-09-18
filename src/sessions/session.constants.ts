import type { CookieOptions } from 'express';

export const DEFAULT_SESSION_COOKIE_NAME = 'omnichain_session';
export const DEFAULT_SESSION_TTL_DAYS = 30;
export const DEFAULT_SESSION_SECRET = 'dev-insecure-session-secret-change-in-prod';

export function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME;
}

export function getSessionTtlMs(): number {
  const days = Number(process.env.SESSION_TTL_DAYS) || DEFAULT_SESSION_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

export function getSessionCookieOptions(): CookieOptions {
  const ttlMs = getSessionTtlMs();
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    signed: true,
    maxAge: ttlMs,
    path: '/',
  };
}
