import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { SCIM_ERROR_SCHEMA } from './scim.types';

/**
 * Answers in the error shape RFC 7644 defines.
 *
 * The application's own filter normalizes everything to one house format,
 * which is right everywhere a human or the front end is reading — and wrong
 * here. A provisioning service parses the body: Entra shows `detail` verbatim
 * in its provisioning log, and that line is the only explanation an
 * administrator will ever get for why one person failed to sync. Normalized
 * into "Scim Exception" it explains nothing.
 */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ScimExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'Internal server error';
    let scimType: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        detail = body;
      } else if (typeof body === 'object' && body !== null) {
        const shaped = body as Record<string, unknown>;
        // Already a SCIM error (thrown by ScimException) — pass it through.
        if (typeof shaped.detail === 'string') detail = shaped.detail;
        else if (typeof shaped.message === 'string') detail = shaped.message;
        else if (Array.isArray(shaped.message)) detail = shaped.message.join(', ');
        if (typeof shaped.scimType === 'string') scimType = shaped.scimType;
      }
    } else {
      /*
       * An unexpected fault still has to be answered in the protocol's shape,
       * but its text is not for the client: an id goes on the wire, the stack
       * stays in the log.
       */
      const errorId = randomUUID();
      this.logger.error(
        `Unhandled SCIM error ${errorId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      detail = `Internal server error (${errorId})`;
    }

    response
      .status(status)
      .type('application/scim+json')
      .json({
        schemas: [SCIM_ERROR_SCHEMA],
        detail,
        status: String(status),
        ...(scimType ? { scimType } : {}),
      });
  }
}
