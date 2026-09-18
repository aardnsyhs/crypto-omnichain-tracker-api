import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  DynamicModule,
  Module,
  Inject,
  SetMetadata,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export const THROTTLER_OPTIONS = 'THROTTLER_OPTIONS';

export interface ThrottlerOption {
  name?: string;
  ttl: number; // in ms
  limit: number;
}

export const SkipThrottle = (): MethodDecorator & ClassDecorator =>
  SetMetadata('skipThrottle', true);

export const Throttle = (options: Record<string, unknown>): MethodDecorator & ClassDecorator =>
  SetMetadata('throttle', options);

export class ThrottlerException extends HttpException {
  constructor(message = 'ThrottlerException: Too Many Requests') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

interface StorageRecord {
  totalHits: number;
  resetTime: number; // epoch ms
}

@Injectable()
export class ThrottlerGuard implements CanActivate {
  private readonly storage = new Map<string, StorageRecord>();
  private readonly options: ThrottlerOption[];

  constructor(
    @Inject(THROTTLER_OPTIONS)
    options: ThrottlerOption[] | { throttlers: ThrottlerOption[] },
  ) {
    this.options = Array.isArray(options)
      ? options
      : options.throttlers || [{ ttl: 60000, limit: 30 }];
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Check skipThrottle metadata
    const skip =
      Reflect.getMetadata('skipThrottle', handler) ?? Reflect.getMetadata('skipThrottle', classRef);
    if (skip) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = (req.ips && req.ips.length > 0 ? req.ips[0] : req.ip) || '127.0.0.1';
    const throttler = this.options[0] || { ttl: 60000, limit: 30 };
    const ttlMs = throttler.ttl;
    const limit = throttler.limit;

    const now = Date.now();
    const trackerKey = `throttler:lookup:${ip}`;

    let record = this.storage.get(trackerKey);
    if (!record || now >= record.resetTime) {
      record = {
        totalHits: 1,
        resetTime: now + ttlMs,
      };
      this.storage.set(trackerKey, record);
    } else {
      record.totalHits += 1;
    }

    const remaining = Math.max(0, limit - record.totalHits);
    const resetEpochSeconds = Math.ceil(record.resetTime / 1000);

    if (res && typeof res.setHeader === 'function') {
      res.setHeader('RateLimit-Limit', limit.toString());
      res.setHeader('RateLimit-Remaining', remaining.toString());
      res.setHeader('RateLimit-Reset', resetEpochSeconds.toString());
    }

    if (record.totalHits > limit) {
      throw new ThrottlerException();
    }

    return true;
  }
}

@Module({})
export class ThrottlerModule {
  static forRoot(options: ThrottlerOption[] | { throttlers: ThrottlerOption[] }): DynamicModule {
    return {
      module: ThrottlerModule,
      global: true,
      providers: [
        {
          provide: THROTTLER_OPTIONS,
          useValue: options,
        },
      ],
      exports: [THROTTLER_OPTIONS],
    };
  }
}
