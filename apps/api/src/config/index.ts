import { availableParallelism } from 'node:os';
import { z } from 'zod';

const MB = 1024 * 1024;

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);

/** Empty strings (e.g. `FOO=` in a .env file) are treated as "unset". */
const emptyAsUndefined = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * Number of reverse proxies in front of the service (0 = none). Needed so rate limiting sees
   * the real client IP instead of the proxy's. Never trust more hops than you actually run:
   * anything beyond them is client-controlled.
   */
  TRUST_PROXY: z
    .string()
    .default('0')
    .transform((value, ctx): number => {
      const hops = value === 'false' ? 0 : Number(value);
      if (!Number.isInteger(hops) || hops < 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a non-negative integer (number of trusted proxy hops)',
        });
        return z.NEVER;
      }
      return hops;
    }),

  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MAX_SOURCE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * MB),
  MAX_SOURCE_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
  ALLOWED_PORTS: csv.default(() => ['80', '443']),
  ALLOWED_HOSTS: csv.default(() => []),
  ALLOW_PRIVATE_NETWORKS: booleanFromEnv.default(false),

  MAX_OUTPUT_DIMENSION: z.coerce.number().int().positive().default(4096),
  /** Largest response body we will return, in bytes. 0 = unlimited. */
  MAX_OUTPUT_BYTES: z.coerce.number().int().min(0).default(0),
  MAX_CONCURRENT_TRANSFORMS: z.coerce
    .number()
    .int()
    .positive()
    .default(() => Math.min(availableParallelism(), 4)),
  MAX_QUEUED_TRANSFORMS: z.coerce.number().int().min(0).default(16),

  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),
  RESULT_CACHE_MB: z.coerce.number().positive().default(128),
  SOURCE_CACHE_MB: z.coerce.number().positive().default(64),
  SOURCE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(300),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  WEB_DIST_DIR: z.string().optional(),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  server: {
    host: string;
    port: number;
    logLevel: string;
    /** Number of trusted reverse-proxy hops in front of the service (0 = none). */
    trustProxyHops: number;
    webDistDir: string | undefined;
  };
  source: {
    fetchTimeoutMs: number;
    maxBytes: number;
    maxPixels: number;
    maxRedirects: number;
    allowedPorts: ReadonlySet<number>;
    allowedHosts: readonly string[];
    allowPrivateNetworks: boolean;
  };
  output: {
    maxDimension: number;
    /** 0 = unlimited. Set where the host caps response size (e.g. serverless platforms). */
    maxBytes: number;
    maxConcurrentTransforms: number;
    maxQueuedTransforms: number;
  };
  cache: {
    ttlSeconds: number;
    resultMaxBytes: number;
    sourceMaxBytes: number;
    sourceTtlSeconds: number;
  };
  rateLimit: {
    max: number;
    windowMs: number;
  };
}

/** Parses and validates environment variables into a typed, immutable config object. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(emptyAsUndefined(env));
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;

  return {
    env: e.NODE_ENV,
    server: {
      host: e.HOST,
      port: e.PORT,
      logLevel: e.LOG_LEVEL,
      trustProxyHops: e.TRUST_PROXY,
      webDistDir: e.WEB_DIST_DIR,
    },
    source: {
      fetchTimeoutMs: e.FETCH_TIMEOUT_MS,
      maxBytes: e.MAX_SOURCE_BYTES,
      maxPixels: e.MAX_SOURCE_PIXELS,
      maxRedirects: e.MAX_REDIRECTS,
      allowedPorts: new Set(e.ALLOWED_PORTS.map(Number)),
      allowedHosts: e.ALLOWED_HOSTS,
      allowPrivateNetworks: e.ALLOW_PRIVATE_NETWORKS,
    },
    output: {
      maxDimension: e.MAX_OUTPUT_DIMENSION,
      maxBytes: e.MAX_OUTPUT_BYTES,
      maxConcurrentTransforms: e.MAX_CONCURRENT_TRANSFORMS,
      maxQueuedTransforms: e.MAX_QUEUED_TRANSFORMS,
    },
    cache: {
      ttlSeconds: e.CACHE_TTL_SECONDS,
      resultMaxBytes: Math.floor(e.RESULT_CACHE_MB * MB),
      sourceMaxBytes: Math.floor(e.SOURCE_CACHE_MB * MB),
      sourceTtlSeconds: e.SOURCE_CACHE_TTL_SECONDS,
    },
    rateLimit: {
      max: e.RATE_LIMIT_MAX,
      windowMs: e.RATE_LIMIT_WINDOW_SECONDS * 1000,
    },
  };
}
