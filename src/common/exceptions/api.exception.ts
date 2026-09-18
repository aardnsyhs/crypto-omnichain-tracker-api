import { HttpException, HttpStatus } from '@nestjs/common';

export type ApiErrorCode =
  | 'INVALID_TRANSACTION_HASH'
  | 'UNSUPPORTED_CHAIN'
  | 'VALIDATION_ERROR'
  | 'TRANSACTION_NOT_FOUND'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UPSTREAM_PROVIDER_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_RATE_LIMITED'
  | 'INTERNAL_SERVER_ERROR';

export class ApiException extends HttpException {
  public readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string, status: HttpStatus) {
    super({ code, message }, status);
    this.code = code;
  }
}
