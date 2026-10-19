import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** `apps/web/dist`, relative to both `src/` (dev) and `dist/` (compiled) of this package. */
const DEFAULT_DIST_DIR = fileURLToPath(new URL('../../../../web/dist', import.meta.url));

/**
 * Serves the built web UI from the same origin, so one deployable unit hosts API and UI.
 *
 * The directory is `WEB_DIST_DIR` when set (the Docker image does this), otherwise the monorepo's
 * `apps/web/dist` if it has been built, so `npm run build && npm start` just works. When there is
 * no UI to serve, `/` answers with a small pointer instead of a bare "not found".
 */
export async function registerWebUi(
  app: FastifyInstance,
  configuredDir: string | undefined,
): Promise<void> {
  const root = resolve(configuredDir ?? DEFAULT_DIST_DIR);

  if (existsSync(resolve(root, 'index.html'))) {
    // `index.html` is served at "/" by default; the UI is a single page with no client routes.
    await app.register(fastifyStatic, { root, maxAge: '5m', wildcard: false });
    return;
  }

  if (configuredDir) {
    app.log.warn({ root }, 'WEB_DIST_DIR has no index.html; the web UI will not be served');
  }
  app.get('/', { schema: { hide: true } }, async () => ({
    name: 'Image Processing API',
    message: 'The API is running. The web UI is not being served from this port.',
    ui: 'Development: open http://localhost:5173 (started by `npm run dev`). Production: run `npm run build` first, then restart.',
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
    example: '/process?url=https%3A%2F%2Fpicsum.photos%2Fid%2F1015%2F1600%2F1000.jpg&width=500',
  }));
}
