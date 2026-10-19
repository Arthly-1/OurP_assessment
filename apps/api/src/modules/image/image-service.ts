import { createHash } from 'node:crypto';
import { Errors } from '../../errors/app-error.js';
import type { Semaphore } from '../../lib/semaphore.js';
import type { Cache } from '../cache/byte-cache.js';
import type { SingleFlight } from '../cache/single-flight.js';
import type { InputFormat } from '../source/image-sniffer.js';
import type { SourceLoader } from '../source/source-loader.js';
import {
  DEFAULT_CROP_MODE,
  type FormatParam,
  type OutputFormat,
  type ProcessQuery,
} from '../transform/options.js';
import type { ImageTransformer } from '../transform/transformer.js';

export interface ProcessedImage {
  data: Buffer;
  format: OutputFormat;
  contentType: string;
  width: number;
  height: number;
  etag: string;
}

export interface ProcessResult extends ProcessedImage {
  cache: 'HIT' | 'MISS';
  /** True when the representation depends on the request's Accept header. */
  varyAccept: boolean;
}

export interface ImageInfo {
  width: number;
  height: number;
  format: InputFormat;
  bytes: number;
  contentType: string | null;
  hasAlpha: boolean;
  animated: boolean;
}

export interface ProcessContext {
  /** Whether the client's Accept header advertises WebP support (used by format=auto). */
  acceptsWebp: boolean;
}

export interface ImageServiceDeps {
  sourceLoader: Pick<SourceLoader, 'load'>;
  transformer: Pick<ImageTransformer, 'inspect' | 'transform'>;
  limiter: Pick<Semaphore, 'run'>;
  resultCache: Cache<ProcessedImage>;
  flights: SingleFlight<ProcessedImage>;
  /** Reject results larger than this many bytes (0 or undefined = no limit). */
  maxOutputBytes?: number;
}

const CONTENT_TYPES: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** Bumping this invalidates every cached result (e.g. after changing encoder settings). */
const CACHE_KEY_VERSION = 1;

/**
 * The application layer: turns a validated request into an image. HTTP concerns (headers,
 * status codes) live in the route; fetching and pixel work live in their own modules.
 */
export class ImageService {
  constructor(private readonly deps: ImageServiceDeps) {}

  async process(query: ProcessQuery, context: ProcessContext): Promise<ProcessResult> {
    const varyAccept = query.format === 'auto';
    const key = resultCacheKey(query, context);

    // Checked before touching the source so a warm result survives source-cache expiry.
    const cached = this.deps.resultCache.get(key);
    if (cached) return { ...cached, cache: 'HIT', varyAccept };

    const processed = await this.deps.flights.run(key, async () => {
      const source = await this.deps.sourceLoader.load(query.url);
      const metadata = await this.deps.transformer.inspect(source.data);
      const format = resolveOutputFormat(query.format, source.format, context.acceptsWebp);

      const result = await this.deps.limiter.run(() =>
        this.deps.transformer.transform(
          source.data,
          {
            width: query.width,
            height: query.height,
            crop: query.crop ?? DEFAULT_CROP_MODE,
            format,
            quality: query.quality,
            background: query.background,
          },
          metadata,
        ),
      );

      const { maxOutputBytes } = this.deps;
      if (maxOutputBytes && result.data.length > maxOutputBytes) {
        throw Errors.outputTooHeavy(result.data.length, maxOutputBytes);
      }

      const entry: ProcessedImage = {
        data: result.data,
        format: result.format,
        contentType: CONTENT_TYPES[result.format],
        width: result.width,
        height: result.height,
        etag: computeEtag(result.data),
      };
      this.deps.resultCache.set(key, entry);
      return entry;
    });

    return { ...processed, cache: 'MISS', varyAccept };
  }

  /** Describes the *source* image (what the UI shows next to the processed one). */
  async inspect(url: string): Promise<ImageInfo> {
    const source = await this.deps.sourceLoader.load(url);
    const metadata = await this.deps.transformer.inspect(source.data);
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      bytes: source.data.length,
      contentType: source.contentType ?? null,
      hasAlpha: metadata.hasAlpha,
      animated: metadata.animated,
    };
  }
}

/**
 * Picks the concrete output format.
 *  - explicit format: honoured (`jpg` is an alias of `jpeg`);
 *  - `auto`: WebP when the client accepts it, else PNG for lossless sources and JPEG otherwise;
 *  - omitted: keep the source format (GIF has no encoder here and becomes PNG).
 */
export function resolveOutputFormat(
  requested: FormatParam | undefined,
  source: InputFormat,
  acceptsWebp: boolean,
): OutputFormat {
  if (requested === 'jpg') return 'jpeg';
  if (requested && requested !== 'auto') return requested;
  if (requested === 'auto' && acceptsWebp) return 'webp';

  if (source === 'png' || source === 'gif') return 'png';
  if (source === 'jpeg') return 'jpeg';
  // WebP/AVIF sources: keep as is, unless `auto` was asked and the client may not decode them.
  return requested === 'auto' ? 'jpeg' : source;
}

function resultCacheKey(query: ProcessQuery, context: ProcessContext): string {
  // `auto` outcomes differ only by WebP support; `jpg` and `jpeg` are the same thing.
  const format =
    query.format === 'auto'
      ? `auto:${context.acceptsWebp ? 'webp' : 'legacy'}`
      : query.format === 'jpg'
        ? 'jpeg'
        : (query.format ?? 'source');
  const fields = [
    CACHE_KEY_VERSION,
    stripFragment(query.url),
    query.width ?? null,
    query.height ?? null,
    query.crop ?? DEFAULT_CROP_MODE,
    format,
    query.quality ?? null,
    query.background?.toLowerCase() ?? null,
  ];
  return createHash('sha256').update(JSON.stringify(fields)).digest('base64url');
}

function stripFragment(url: string): string {
  const index = url.indexOf('#');
  return index === -1 ? url : url.slice(0, index);
}

function computeEtag(data: Buffer): string {
  return `"${createHash('sha1').update(data).digest('base64url')}"`;
}
