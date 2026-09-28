import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  /**
   * Machine-readable discriminator such as TOTP_REQUIRED. The client branches
   * on this — the sign-in screen only knows to ask for a second factor because
   * of it — so it must survive normalisation rather than being flattened into
   * a human sentence.
   */
  code?: string;
  /** Correlates the client-visible error with the server log entry. */
  errorId: string;
  path: string;
  timestamp: string;
}

/**
 * Normalizes every error into one shape.
 *
 * Unexpected errors are logged in full but reported to the client as a generic
 * message plus an error id — stack traces and driver messages can disclose
 * schema and infrastructure details.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const errorId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    let code: string | undefined;

    /*
     * Errors raised before Nest sees the request — the body parser rejecting an
     * oversized or malformed payload is the common one — are plain Express
     * errors carrying their own status. Without this they fall through to the
     * 500 branch below, so a request the client got wrong is answered, and
     * logged, as a fault on our side.
     */
    const raw = exception as { status?: unknown; statusCode?: unknown; message?: unknown };
    const rawStatus = typeof raw?.status === 'number' ? raw.status : raw?.statusCode;
    if (
      !(exception instanceof HttpException) &&
      typeof rawStatus === 'number' &&
      rawStatus >= 400 &&
      rawStatus < 500
    ) {
      status = rawStatus;
      message = typeof raw.message === 'string' ? raw.message : 'Request rejected';
      // HttpStatus names the code PAYLOAD_TOO_LARGE; every other response in
      // this filter reads "Payload Too Large", so it is spelled the same way.
      error = HttpStatus[rawStatus]
        ? String(HttpStatus[rawStatus])
            .toLowerCase()
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
        : 'Bad Request';
    }

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        message = payload;
        error = exception.name;
      } else if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        message = (record.message as string | string[]) ?? exception.message;
        error = (record.error as string) ?? exception.name;
        if (typeof record.code === 'string') code = record.code;
      }
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${errorId}] ${request.method} ${request.url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`[${errorId}] ${request.method} ${request.url} → ${status}`);
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      ...(code ? { code } : {}),
      errorId,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }
}
