import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppConfig } from '../../config/index.js';
import type { ImageService } from '../../modules/image/image-service.js';
import { createProcessQuerySchema } from '../../modules/transform/options.js';
import { errorResponses } from '../schemas.js';

interface ProcessRouteOptions {
  service: ImageService;
  config: AppConfig;
}

export const processRoute: FastifyPluginAsyncZod<ProcessRouteOptions> = async (app, options) => {
  const { service, config } = options;
  const cacheControl = `public, max-age=${config.cache.ttlSeconds}`;

  app.get(
    '/process',
    {
      schema: {
        tags: ['Images'],
        summary: 'Resize, crop and convert an image',
        description:
          'Fetches the image at `url`, applies the requested transformations and returns the ' +
          'resulting image bytes. Responses are cacheable (`Cache-Control`, `ETag`) and ' +
          'conditional requests with `If-None-Match` return `304`.',
        querystring: createProcessQuerySchema(config.output),
        // 200 is raw bytes (documented by hand in the OpenAPI plugin), so it is not Zod-serialized.
        response: { 200: z.any(), 304: z.undefined(), ...errorResponses },
      },
    },
    async (request, reply) => {
      const acceptsWebp = /\bimage\/webp\b/i.test(request.headers.accept ?? '');
      const image = await service.process(request.query, { acceptsWebp });

      reply.headers({
        'cache-control': cacheControl,
        etag: image.etag,
        'x-cache': image.cache,
        'x-image-width': String(image.width),
        'x-image-height': String(image.height),
        // The bytes are attacker-influenced: forbid sniffing and any active content if opened directly.
        'content-security-policy': "default-src 'none'; sandbox",
      });
      if (image.varyAccept) reply.header('vary', 'Accept');

      if (matchesEtag(request.headers['if-none-match'], image.etag)) {
        return reply.status(304).send();
      }
      return reply.type(image.contentType).send(image.data);
    },
  );
};

/** Weak comparison per RFC 9110 section 13.1.2; `*` matches anything. */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
}
