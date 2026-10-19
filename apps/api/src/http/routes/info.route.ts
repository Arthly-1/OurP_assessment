import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppConfig } from '../../config/index.js';
import type { ImageService } from '../../modules/image/image-service.js';
import { infoQuerySchema } from '../../modules/transform/options.js';
import { errorResponses, imageInfoSchema } from '../schemas.js';

interface InfoRouteOptions {
  service: ImageService;
  config: AppConfig;
}

export const infoRoute: FastifyPluginAsyncZod<InfoRouteOptions> = async (
  app,
  { service, config },
) => {
  app.get(
    '/info',
    {
      schema: {
        tags: ['Images'],
        summary: 'Describe a source image',
        description:
          'Returns the dimensions, format and file size of the image at `url` without transforming it.',
        querystring: infoQuerySchema,
        response: { 200: imageInfoSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const info = await service.inspect(request.query.url);
      reply.header('cache-control', `public, max-age=${config.cache.ttlSeconds}`);
      return info;
    },
  );
};
