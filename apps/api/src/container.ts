import type { AppConfig } from './config/index.js';
import { Errors } from './errors/app-error.js';
import { Semaphore } from './lib/semaphore.js';
import { ByteCache } from './modules/cache/byte-cache.js';
import { SingleFlight } from './modules/cache/single-flight.js';
import { ImageService, type ProcessedImage } from './modules/image/image-service.js';
import { SafeFetcher } from './modules/source/safe-fetcher.js';
import { SourceLoader, type SourceImage } from './modules/source/source-loader.js';
import { SourceUrlPolicy } from './modules/source/url-policy.js';
import { ImageTransformer } from './modules/transform/transformer.js';

export interface Container {
  imageService: ImageService;
  close(): Promise<void>;
}

export interface ContainerOverrides {
  /** Replace the network layer (tests). */
  fetcher?: Pick<SafeFetcher, 'fetch' | 'close'>;
}

/** Composition root: the only place that knows how the concrete pieces fit together. */
export function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const policy = new SourceUrlPolicy(config.source);
  const fetcher =
    overrides.fetcher ??
    new SafeFetcher(policy, {
      timeoutMs: config.source.fetchTimeoutMs,
      maxBytes: config.source.maxBytes,
      maxRedirects: config.source.maxRedirects,
    });

  const sourceLoader = new SourceLoader({
    fetcher,
    cache: new ByteCache<SourceImage>({
      maxBytes: config.cache.sourceMaxBytes,
      ttlMs: config.cache.sourceTtlSeconds * 1000,
      sizeOf: (source) => source.data.length,
    }),
    flights: new SingleFlight<SourceImage>(),
  });

  const imageService = new ImageService({
    sourceLoader,
    transformer: new ImageTransformer({
      maxPixels: config.source.maxPixels,
      maxDimension: config.output.maxDimension,
    }),
    limiter: new Semaphore(
      config.output.maxConcurrentTransforms,
      config.output.maxQueuedTransforms,
      Errors.overloaded,
    ),
    resultCache: new ByteCache<ProcessedImage>({
      maxBytes: config.cache.resultMaxBytes,
      ttlMs: config.cache.ttlSeconds * 1000,
      sizeOf: (image) => image.data.length,
    }),
    flights: new SingleFlight<ProcessedImage>(),
    maxOutputBytes: config.output.maxBytes,
  });

  return { imageService, close: () => fetcher.close() };
}
