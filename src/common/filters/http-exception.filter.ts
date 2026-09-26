import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'node:crypto';
import { ApiException, ApiErrorCode } from '../exceptions/api.exception';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = (request.headers['x-request-id'] as string) || crypto.randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'An internal server error occurred.';

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        code = 'RATE_LIMIT_EXCEEDED';
        message = 'Client has exceeded public API lookup rate limits.';
      } else if (status === HttpStatus.BAD_REQUEST) {
        code = 'VALIDATION_ERROR';
        if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
          const resObj = exceptionResponse as Record<string, unknown>;
          const msgArray = Array.isArray(resObj.message) ? resObj.message : [resObj.message];
          const rawMsg = msgArray.join('; ');

          if (
            msgArray.length === 1 &&
            (rawMsg.includes('must match 0x') ||
              (rawMsg.includes('transactionHash') && !rawMsg.includes('required')))
          ) {
            code = 'INVALID_TRANSACTION_HASH';
            if (rawMsg.includes('without 0x prefix') || rawMsg.includes('hexadecimal transaction ID')) {
              message = rawMsg;
            } else {
              message =
                'The provided transaction hash does not match 0x followed by 64 hexadecimal characters.';
            }
          } else if (
            msgArray.length === 1 &&
            (rawMsg.includes('must be one of') ||
              (rawMsg.includes('chain') && !rawMsg.includes('required')))
          ) {
            code = 'UNSUPPORTED_CHAIN';
            message =
              'The provided chain is not supported. Must be one of: ethereum, bitcoin, litecoin, dogecoin, bitcoin-cash, dash.';
          } else {
            code = 'VALIDATION_ERROR';
            message = rawMsg || 'Invalid request payload.';
          }
        }
      } else if (status === HttpStatus.NOT_FOUND) {
        code = 'TRANSACTION_NOT_FOUND';
        message = exception.message || 'Resource not found.';
      } else {
        message = exception.message;
      }
    } else {
      this.logger.error(
        `Unhandled exception: ${(exception as Error).message}`,
        (exception as Error).stack,
      );
    }

    response.status(status).json({
      error: {
        code,
        message,
        requestId,
      },
    });
  }
}
