import { isIP } from 'node:net';

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const production = env.NODE_ENV === 'production';
  const problems: string[] = [];
  const defaults: Record<string, string> = {
    SESSION_SECRET: 'dev-insecure-session-secret-change-in-prod',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/omnichain_tracker?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'http://localhost:3000',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!env[key]?.trim()) {
      if (production) problems.push(`${key} is required`);
      else env[key] = value;
    }
  }
  if (
    production &&
    (env.SESSION_SECRET === defaults.SESSION_SECRET ||
      (env.SESSION_SECRET?.length ?? 0) < 32 ||
      new Set(env.SESSION_SECRET).size < 8 ||
      /replace|placeholder|change.me/i.test(env.SESSION_SECRET ?? ''))
  ) {
    problems.push(
      'SESSION_SECRET must be a random secret of at least 32 characters (generate with openssl rand -hex 32)',
    );
  }
  const urls: Record<string, string[]> = {
    DATABASE_URL: ['postgres:', 'postgresql:'],
    REDIS_URL: ['redis:', 'rediss:'],
    WEB_ORIGIN: production ? ['https:'] : ['http:', 'https:'],
    BLOCKCHAIR_BASE_URL: ['https:', 'http:'],
  };
  for (const key of [
    'ETHEREUM_RPC_URL',
    'BSC_RPC_URL',
    'POLYGON_RPC_URL',
    'RPC_URL_ETHEREUM',
    'RPC_URL_BSC',
    'RPC_URL_POLYGON',
  ])
    urls[key] = ['https:', 'http:'];
  for (const [key, protocols] of Object.entries(urls)) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]);
      if (!protocols.includes(url.protocol) || !url.hostname) throw new Error();
      if (key === 'WEB_ORIGIN' && (url.origin !== env[key] || url.username || url.password))
        throw new Error();
    } catch {
      problems.push(
        `${key} must be a valid ${protocols.join('/')} URL${key === 'WEB_ORIGIN' ? ' origin without path, credentials, or trailing slash' : ''}`,
      );
    }
  }
  const ranges: Record<string, [number, number]> = {
    PORT: [1, 65535],
    API_PORT: [1, 65535],
    SESSION_TTL_DAYS: [1, 365],
    TRANSACTION_CACHE_TTL_SECONDS: [1, 604800],
    TRANSACTION_CACHE_TTL_DEGRADED: [1, 3600],
    TRANSACTION_CACHE_TTL_PENDING: [0, 60],
    BLOCKCHAIR_TIMEOUT_MS: [100, 30000],
    THROTTLE_TTL_SECONDS: [1, 3600],
    THROTTLE_LIMIT: [1, 10000],
    OVERVIEW_THROTTLE_LIMIT: [1, 10000],
    REFRESH_COOLDOWN_SECONDS: [1, 300],
    HEALTH_TIMEOUT_MS: [100, 5000],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (
      env[key] !== undefined &&
      (!/^\d+$/.test(env[key]) || Number(env[key]) < min || Number(env[key]) > max)
    )
      problems.push(`${key} must be an integer from ${min} to ${max}`);
  }
  if (env.API_HOST && !isIP(env.API_HOST)) problems.push('API_HOST must be an IP address');
  if (env.TRUST_LOCAL_PROXY && !['true', 'false'].includes(env.TRUST_LOCAL_PROXY))
    problems.push('TRUST_LOCAL_PROXY must be true or false');
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
}
