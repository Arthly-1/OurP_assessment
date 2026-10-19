import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Reuses a caller-supplied `X-Request-Id` (handy for tracing through a gateway) only when it is
 * short and header-safe; otherwise generates one. Never echo unvalidated input into logs/headers.
 */
export function generateRequestId(request: IncomingMessage): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
}
