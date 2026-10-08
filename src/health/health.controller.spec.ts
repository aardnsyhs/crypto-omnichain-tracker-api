import { jest } from '@jest/globals';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';

describe('Health checks', () => {
  const database = { isHealthy: jest.fn<() => Promise<boolean>>() };
  const redis = { ping: jest.fn<() => Promise<boolean>>() };
  let controller: HealthController;
  beforeEach(() => {
    database.isHealthy.mockResolvedValue(true);
    redis.ping.mockResolvedValue(true);
    controller = new HealthController(
      new HealthService(database as unknown as PrismaService, redis as unknown as CacheService),
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });
  it('liveness requires no dependencies', () => {
    expect(controller.getLive().status).toBe('ok');
    expect(database.isHealthy).not.toHaveBeenCalled();
  });
  it('checks both dependencies', async () => {
    expect((await controller.getReady()).status).toBe('ready');
  });
  it('reports a database failure without internal details', async () => {
    database.isHealthy.mockRejectedValue(new Error('secret credentials'));
    const response = await controller.getReady();
    expect(response.status).toBe('unavailable');
    expect(JSON.stringify(response)).not.toContain('secret');
  });
  it('allows cache bypass', async () => {
    redis.ping.mockResolvedValue(false);
    expect(await controller.getReady()).toMatchObject({
      status: 'degraded',
      checks: { redis: 'bypassed' },
    });
  });
  it('bounds hung checks', async () => {
    jest.useFakeTimers();
    database.isHealthy.mockImplementation(() => new Promise(() => {}));
    const response = controller.getReady();
    await jest.advanceTimersByTimeAsync(2100);
    expect((await response).status).toBe('unavailable');
  });
});
