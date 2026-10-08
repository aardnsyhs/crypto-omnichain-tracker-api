import { validateEnvironment } from './environment';

describe('startup configuration', () => {
  const valid = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'production',
    SESSION_SECRET: '0123456789abcdef'.repeat(4),
    DATABASE_URL: 'postgresql://user:password@127.0.0.1/db',
    REDIS_URL: 'redis://127.0.0.1:6379',
    WEB_ORIGIN: 'https://tracker.ardiansyah.app',
  });
  it('requires explicit production settings and never exposes secrets', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL is required',
    );
    const env = valid();
    env.DATABASE_URL = 'private-secret';
    expect(() => validateEnvironment(env)).toThrow('DATABASE_URL must be');
    try {
      validateEnvironment(env);
    } catch (error) {
      expect(String(error)).not.toContain('private-secret');
    }
  });
  it.each(['0', '-1', '12abc', 'NaN', '65536', ''])('rejects port %s', (PORT) => {
    expect(() => validateEnvironment({ ...valid(), PORT })).toThrow('PORT');
  });
  it.each(['dev-insecure-session-secret-change-in-prod', 'a'.repeat(64), 'short'])(
    'rejects weak secrets',
    (SESSION_SECRET) => {
      expect(() => validateEnvironment({ ...valid(), SESSION_SECRET })).toThrow('SESSION_SECRET');
    },
  );
  it('requires an HTTPS origin', () => {
    expect(() =>
      validateEnvironment({ ...valid(), WEB_ORIGIN: 'http://tracker.ardiansyah.app' }),
    ).toThrow('WEB_ORIGIN');
  });
  it('provides development defaults', () => {
    const env = {};
    validateEnvironment(env);
    expect(env).toHaveProperty('DATABASE_URL');
  });
  it('accepts production configuration', () => {
    expect(() => validateEnvironment(valid())).not.toThrow();
  });
});
