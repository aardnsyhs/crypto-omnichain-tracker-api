import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  describe('getLive', () => {
    it('should return status ok with uptime and timestamp', () => {
      const result = controller.getLive();
      expect(result.status).toBe('ok');
      expect(typeof result.uptimeSeconds).toBe('number');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(typeof result.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    });
  });

  describe('getReady', () => {
    it('should return honest degraded readiness payload', () => {
      const result = controller.getReady();
      expect(result).toEqual({
        status: 'degraded',
        checks: {
          api: 'ready',
          database: 'not_checked',
          redis: 'not_checked',
        },
        phase: 'milestone-1a',
      });
    });
  });
});
