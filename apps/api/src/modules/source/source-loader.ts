import { Errors } from '../../errors/app-error.js';
import type { Cache } from '../cache/byte-cache.js';
import type { SingleFlight } from '../cache/single-flight.js';
import { sniffImageFormat, type InputFormat } from './image-sniffer.js';
import type { SafeFetcher } from './safe-fetcher.js';

export interface SourceImage {
  data: Buffer;
  format: InputFormat;
  contentType: string | undefined;
  finalUrl: string;
}

export interface SourceLoaderDeps {
  fetcher: Pick<SafeFetcher, 'fetch'>;
  cache: Cache<SourceImage>;
  flights: SingleFlight<SourceImage>;
}

/**
 * Loads and validates source images. Combines three concerns that all exist to make repeated
 * work cheap: a byte-bounded cache (many transformations of one source), request coalescing
 * (a burst of identical requests triggers one upstream fetch) and magic-byte validation.
 */
export class SourceLoader {
  constructor(private readonly deps: SourceLoaderDeps) {}

  load(url: string): Promise<SourceImage> {
    const key = cacheKey(url);
    const cached = this.deps.cache.get(key);
    if (cached) return Promise.resolve(cached);

    return this.deps.flights.run(key, async () => {
      const fetched = await this.deps.fetcher.fetch(url);
      const format = sniffImageFormat(fetched.data);
      if (!format) {
        throw Errors.unsupportedMediaType(
          'The URL did not return a supported image. Supported input formats: JPEG, PNG, WebP, GIF, AVIF.',
        );
      }
      const source: SourceImage = { ...fetched, format };
      this.deps.cache.set(key, source);
      return source;
    });
  }
}

/** Fragments never reach the server, so they must not fragment the cache. */
function cacheKey(url: string): string {
  const hashIndex = url.indexOf('#');
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}
