import { Agent, request } from 'undici';
import { Errors, findAppError, type AppError } from '../../errors/app-error.js';
import { createGuardedLookup } from './guarded-lookup.js';
import type { SourceUrlPolicy } from './url-policy.js';

export interface FetcherLimits {
  /** Wall-clock budget for the whole fetch: every redirect hop plus reading the body. */
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

export interface FetchedSource {
  data: Buffer;
  /** Upstream `Content-Type`, informational only (the real type is sniffed from the bytes). */
  contentType: string | undefined;
  /** URL after following redirects. */
  finalUrl: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'image-processing-service/1.0';

/**
 * Downloads an untrusted URL with hard limits. Safeguards, in order:
 *  1. every URL (including each redirect target) goes through {@link SourceUrlPolicy};
 *  2. connections use a guarded DNS lookup, so the validated IP is the connected IP;
 *  3. redirects are followed manually, capped, and re-validated each hop;
 *  4. a single deadline covers connect, headers, redirects and body;
 *  5. the body is streamed and aborted as soon as it exceeds the size limit;
 *  6. non-image `Content-Type`s are rejected before downloading the body.
 */
export class SafeFetcher {
  private readonly agent: Agent;

  constructor(
    private readonly policy: SourceUrlPolicy,
    private readonly limits: FetcherLimits,
  ) {
    this.agent = new Agent({
      connect: { lookup: createGuardedLookup(policy), timeout: limits.timeoutMs },
      headersTimeout: limits.timeoutMs,
      bodyTimeout: limits.timeoutMs,
    });
  }

  async fetch(rawUrl: string): Promise<FetchedSource> {
    const signal = AbortSignal.timeout(this.limits.timeoutMs);
    try {
      return await this.fetchFollowingRedirects(rawUrl, signal);
    } catch (error) {
      throw this.translateError(error, signal);
    }
  }

  async close(): Promise<void> {
    await this.agent.close();
  }

  private async fetchFollowingRedirects(
    rawUrl: string,
    signal: AbortSignal,
  ): Promise<FetchedSource> {
    let url = this.policy.parse(rawUrl);

    for (let hop = 0; hop <= this.limits.maxRedirects; hop++) {
      const response = await request(url, {
        method: 'GET',
        dispatcher: this.agent,
        signal,
        headers: { accept: 'image/*', 'user-agent': USER_AGENT },
      });
      const { statusCode, headers, body } = response;

      if (REDIRECT_STATUSES.has(statusCode)) {
        await body.dump();
        const location = headers.location;
        if (typeof location !== 'string' || location === '') {
          throw Errors.sourceError(
            `The source server sent a redirect (HTTP ${statusCode}) without a Location.`,
          );
        }
        url = this.policy.parse(new URL(location, url).href);
        continue;
      }

      if (statusCode === 404 || statusCode === 410) {
        await body.dump();
        throw Errors.sourceNotFound(statusCode);
      }
      if (statusCode < 200 || statusCode >= 300) {
        await body.dump();
        throw Errors.sourceError(`The source server responded with HTTP ${statusCode}.`);
      }

      const contentType = firstHeader(headers['content-type']);
      if (!isPlausibleImageContentType(contentType)) {
        await body.dump();
        throw Errors.unsupportedMediaType(
          `The URL returned "${contentType?.split(';')[0]}", which is not a supported image type.`,
        );
      }
      const declaredLength = Number(firstHeader(headers['content-length']));
      if (Number.isFinite(declaredLength) && declaredLength > this.limits.maxBytes) {
        await body.dump();
        throw Errors.sourceTooLarge(this.limits.maxBytes);
      }

      return { data: await this.readBody(body), contentType, finalUrl: url.href };
    }

    throw Errors.sourceError(
      `The source URL redirected more than ${this.limits.maxRedirects} times.`,
    );
  }

  private async readBody(body: AsyncIterable<Buffer>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of body) {
      received += chunk.length;
      if (received > this.limits.maxBytes) {
        (body as unknown as { destroy(): void }).destroy();
        throw Errors.sourceTooLarge(this.limits.maxBytes);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, received);
  }

  /** Maps transport-level failures onto the API's error vocabulary. */
  private translateError(error: unknown, signal: AbortSignal): AppError {
    const appError = findAppError(error);
    if (appError) return appError;
    if (signal.aborted) return Errors.sourceTimeout(this.limits.timeoutMs);

    const code = errorCode(error);
    switch (code) {
      case 'UND_ERR_CONNECT_TIMEOUT':
      case 'UND_ERR_HEADERS_TIMEOUT':
      case 'UND_ERR_BODY_TIMEOUT':
        return Errors.sourceTimeout(this.limits.timeoutMs);
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return Errors.sourceUnreachable('the hostname could not be resolved', error);
      case 'ECONNREFUSED':
        return Errors.sourceUnreachable('the connection was refused', error);
      case 'ECONNRESET':
      case 'UND_ERR_SOCKET':
        return Errors.sourceUnreachable('the connection was closed unexpectedly', error);
      default:
        if (code?.startsWith('ERR_TLS') || code?.includes('CERT') || code?.includes('SSL')) {
          return Errors.sourceUnreachable('the TLS certificate could not be verified', error);
        }
        return Errors.sourceUnreachable(
          code ? `connection failed (${code})` : 'connection failed',
          error,
        );
    }
  }
}

function errorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === 'string') return code;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Cheap early rejection of obvious non-images (HTML error pages, JSON, SVG...). Servers often
 * label images as octet-stream or omit the header, so those pass; the magic-byte sniff in the
 * source loader is the real authority.
 */
function isPlausibleImageContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'image/svg+xml') return false;
  return (
    type.startsWith('image/') ||
    type === 'application/octet-stream' ||
    type === 'binary/octet-stream'
  );
}
