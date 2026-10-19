/** Typed client for the public API. Deliberately free of any DOM code so it can be unit-tested
 * and later extracted into a standalone SDK. */

export interface ProcessParams {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  format?: string | undefined;
  quality?: number | undefined;
  crop?: string | undefined;
  background?: string | undefined;
}

export interface ProcessedImage {
  objectUrl: string;
  bytes: number;
  contentType: string;
  width: number | undefined;
  height: number | undefined;
  cache: string | undefined;
  requestId: string | undefined;
  durationMs: number;
}

export interface SourceInfo {
  width: number;
  height: number;
  format: string;
  bytes: number;
  contentType: string | null;
  hasAlpha: boolean;
  animated: boolean;
}

export interface ApiErrorDetail {
  param?: string;
  message: string;
}

/** Any failure talking to the API: a structured error response, or a network/protocol problem. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const PARAM_ORDER = ['url', 'width', 'height', 'format', 'quality', 'crop', 'background'] as const;

/** Builds the exact request URL, omitting unset parameters. Parameter order is stable. */
export function buildProcessUrl(params: ProcessParams, origin: string = ''): string {
  const search = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    const value = params[key];
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return `${origin}/process?${search.toString()}`;
}

export function buildInfoUrl(url: string, origin: string = ''): string {
  return `${origin}/info?${new URLSearchParams({ url }).toString()}`;
}

const EXTENSIONS: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };

/** A copy-pasteable curl command, safely single-quoted for POSIX shells. */
export function toCurl(requestUrl: string, format?: string): string {
  const extension = (format && EXTENSIONS[format]) || 'img';
  const quoted = `'${requestUrl.replace(/'/g, `'\\''`)}'`;
  const accept = format === 'auto' ? " -H 'Accept: image/webp,*/*'" : '';
  return `curl -sS${accept} -o output.${extension} ${quoted}`;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Prefix for API paths; empty means same origin. */
  origin?: string;
}

export async function fetchProcessed(
  params: ProcessParams,
  options: RequestOptions = {},
): Promise<ProcessedImage> {
  const started = performance.now();
  const response = await send(buildProcessUrl(params, options.origin), options.signal, {
    // Lets `format=auto` negotiate; browsers send this for <img> requests too.
    accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
  });
  const blob = await response.blob();
  const header = (name: string) => response.headers.get(name) ?? undefined;
  const numeric = (name: string) => {
    const value = Number(header(name));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  return {
    objectUrl: URL.createObjectURL(blob),
    bytes: blob.size,
    contentType: blob.type || header('content-type') || 'unknown',
    width: numeric('x-image-width'),
    height: numeric('x-image-height'),
    cache: header('x-cache'),
    requestId: header('x-request-id'),
    durationMs: Math.round(performance.now() - started),
  };
}

export async function fetchInfo(url: string, options: RequestOptions = {}): Promise<SourceInfo> {
  const response = await send(buildInfoUrl(url, options.origin), options.signal, {
    accept: 'application/json',
  });
  return (await response.json()) as SourceInfo;
}

async function send(
  url: string,
  signal: AbortSignal | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { headers, ...(signal && { signal }) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'network_error',
      'Could not reach the API. Check your connection and that the service is running.',
      0,
    );
  }
  if (response.ok) return response;
  throw await toApiError(response);
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfter = Number(response.headers.get('retry-after'));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: ApiErrorDetail[]; requestId?: string };
    };
    if (body.error?.code && body.error.message) {
      return new ApiError(
        body.error.code,
        body.error.message,
        response.status,
        body.error.details ?? [],
        body.error.requestId,
        retryAfterSeconds,
      );
    }
  } catch {
    // Not JSON: fall through (typically an HTML error page from a proxy in front of the service).
  }
  return new ApiError(
    'unexpected_response',
    `The server responded with HTTP ${response.status} ${response.statusText}.`.trim(),
    response.status,
    [],
    undefined,
    retryAfterSeconds,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
