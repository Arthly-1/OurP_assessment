// Vercel serverless entry point. Vercel runs functions, not a long-lived server, so the same
// Fastify app that `npm start` runs is built once per warm instance and fed requests directly.
// The compiled app comes from `npm run build` (see vercel.json); nothing here duplicates logic.
import { buildApp } from '../apps/api/dist/app.js';
import { loadConfig } from '../apps/api/dist/config/index.js';

/**
 * Defaults tuned for a serverless host. Anything set in the Vercel project's environment wins.
 *  - TRUST_PROXY=1: Vercel is exactly one proxy hop in front of the function.
 *  - MAX_OUTPUT_BYTES: Vercel rejects function responses larger than 4.5 MB, so refuse earlier
 *    with a clear error instead of failing opaquely.
 *  - smaller caches: they only live as long as a warm instance, so keep memory modest.
 */
const SERVERLESS_DEFAULTS = {
  TRUST_PROXY: '1',
  MAX_OUTPUT_BYTES: String(4_000_000),
  RESULT_CACHE_MB: '48',
  SOURCE_CACHE_MB: '24',
  MAX_CONCURRENT_TRANSFORMS: '2',
  MAX_QUEUED_TRANSFORMS: '8',
  FETCH_TIMEOUT_MS: '8000',
};

/** @type {Promise<import('fastify').FastifyInstance> | undefined} */
let appPromise;

function getApp() {
  appPromise ??= (async () => {
    const app = await buildApp(loadConfig({ ...SERVERLESS_DEFAULTS, ...process.env }));
    await app.ready();
    return app;
  })();
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
