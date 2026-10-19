/**
 * Machine-readable error codes. These are part of the public API contract: clients are expected
 * to branch on `error.code`, so never rename one without versioning the API.
 */
export type ErrorCode =
  | 'invalid_parameter'
  | 'url_not_allowed'
  | 'source_not_found'
  | 'source_unreachable'
  | 'source_error'
  | 'source_timeout'
  | 'source_too_large'
  | 'unsupported_media_type'
  | 'invalid_image'
  | 'output_too_large'
  | 'not_found'
  | 'rate_limited'
  | 'overloaded'
  | 'bad_request'
  | 'internal_error';

export interface ErrorDetail {
  /** Query parameter the problem relates to, when applicable. */
  param?: string;
  message: string;
}

/** An expected, caller-facing failure. Anything else reaching the error handler is a 500. */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    statusCode: number,
    message: string,
    readonly details?: ErrorDetail[],
    readonly headers?: Record<string, string>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

/** Walks the `cause` chain looking for an AppError (HTTP clients wrap errors thrown by hooks). */
export function findAppError(error: unknown): AppError | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof AppError) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

/** Factory functions keep status codes and wording for each failure in a single place. */
export const Errors = {
  invalidParameter: (details: ErrorDetail[]) =>
    new AppError(
      'invalid_parameter',
      400,
      details.length === 1 && details[0]
        ? details[0].message
        : 'One or more query parameters are invalid.',
      details,
    ),

  urlNotAllowed: (reason: string) =>
    new AppError('url_not_allowed', 400, `This URL cannot be fetched: ${reason}`, [
      { param: 'url', message: reason },
    ]),

  sourceNotFound: (upstreamStatus: number) =>
    new AppError(
      'source_not_found',
      404,
      `The source image was not found (HTTP ${upstreamStatus}).`,
    ),

  sourceUnreachable: (reason: string, cause?: unknown) =>
    new AppError(
      'source_unreachable',
      502,
      `Could not reach the source URL: ${reason}`,
      undefined,
      undefined,
      { cause },
    ),

  sourceError: (message: string) => new AppError('source_error', 502, message),

  sourceTimeout: (timeoutMs: number) =>
    new AppError(
      'source_timeout',
      504,
      `The source server did not deliver the image within ${timeoutMs / 1000}s.`,
    ),

  sourceTooLarge: (maxBytes: number) =>
    new AppError(
      'source_too_large',
      413,
      `The source image exceeds the maximum size of ${formatBytes(maxBytes)}.`,
    ),

  unsupportedMediaType: (message: string) => new AppError('unsupported_media_type', 415, message),

  invalidImage: (message: string) => new AppError('invalid_image', 422, message),

  outputTooLarge: (maxDimension: number, width: number, height: number) =>
    new AppError(
      'output_too_large',
      422,
      `The requested transformation would produce a ${width}x${height} image; ` +
        `the maximum is ${maxDimension}px per side. Lower width/height or provide both.`,
    ),

  outputTooHeavy: (actualBytes: number, maxBytes: number) =>
    new AppError(
      'output_too_large',
      422,
      `The processed image is ${formatBytes(actualBytes)}, but this deployment returns at most ` +
        `${formatBytes(maxBytes)}. Lower the width/height or quality, or choose a smaller format.`,
    ),

  notFound: (message = 'Route not found.') => new AppError('not_found', 404, message),

  rateLimited: (retryAfterSeconds: number) =>
    new AppError(
      'rate_limited',
      429,
      `Rate limit exceeded. Retry in ${retryAfterSeconds}s.`,
      undefined,
      { 'retry-after': String(retryAfterSeconds) },
    ),

  overloaded: () =>
    new AppError(
      'overloaded',
      503,
      'The service is busy processing other images. Please retry shortly.',
      undefined,
      { 'retry-after': '2' },
    ),

  badRequest: (message: string) => new AppError('bad_request', 400, message),

  internal: () => new AppError('internal_error', 500, 'An unexpected error occurred.'),
} as const;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${+(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${+(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
