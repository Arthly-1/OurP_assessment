import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, Errors, findAppError } from '../../errors/app-error.js';
import type { ErrorResponse } from '../schemas.js';

/**
 * Every failure leaves the service in one shape:
 * `{ "error": { code, message, status, requestId, details? } }`.
 * Unexpected errors are logged in full but reported to the caller without internals.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    const appError = toAppError(error);
    if (appError.statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ code: appError.code, status: appError.statusCode }, appError.message);
    }
    return sendError(request, reply, appError);
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(
      request,
      reply,
      Errors.notFound(`Route ${request.method} ${request.url.split('?')[0]} not found.`),
    ),
  );
}

function toAppError(error: unknown): AppError {
  const known = findAppError(error);
  if (known) return known;

  // Framework-level client errors (malformed JSON, bad content-type, URL too long...).
  const { statusCode, message } = (error ?? {}) as Partial<FastifyError>;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return new AppError(
      statusCode === 404 ? 'not_found' : 'bad_request',
      statusCode,
      message ?? 'Bad request.',
    );
  }
  return Errors.internal();
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: AppError): FastifyReply {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      status: error.statusCode,
      requestId: request.id,
      ...(error.details && { details: error.details }),
    },
  };
  return reply
    .status(error.statusCode)
    .headers({ ...error.headers, 'cache-control': 'no-store' })
    .send(body);
}
