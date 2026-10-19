import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import type { AppConfig } from '../../config/index.js';

type OpenApiDocument = {
  paths?: Record<string, { get?: { responses?: Record<string, unknown> } }>;
};

/**
 * Serves an OpenAPI 3 document (generated from the same Zod schemas that validate requests, so
 * it cannot drift) at `/openapi.json`, and interactive docs at `/docs`.
 */
export async function registerOpenApi(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Image Processing API',
        version: '1.0.0',
        description:
          'Fetch a remote image and resize, crop and convert it on the fly. ' +
          `Limits: source <= ${config.source.maxBytes / 1024 / 1024} MB, ` +
          `output <= ${config.output.maxDimension}px per side, ` +
          `${config.rateLimit.max} requests per ${config.rateLimit.windowMs / 1000}s per client.`,
      },
      tags: [
        { name: 'Images', description: 'Image transformation endpoints' },
        { name: 'Operations', description: 'Health and diagnostics' },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: (input) => addBinaryImageResponse(jsonSchemaTransformObject(input)),
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
}

/** `/process` returns raw image bytes, which Zod response schemas cannot describe. */
function addBinaryImageResponse<T extends object>(generated: T): T {
  const document = generated as OpenApiDocument;
  const operation = document.paths?.['/process']?.get;
  if (operation) {
    operation.responses = {
      ...operation.responses,
      200: {
        description: 'The processed image.',
        headers: {
          'Cache-Control': { schema: { type: 'string' } },
          ETag: { schema: { type: 'string' } },
          'X-Cache': {
            description: 'HIT when served from the processed-image cache.',
            schema: { type: 'string', enum: ['HIT', 'MISS'] },
          },
          'X-Image-Width': { schema: { type: 'integer' } },
          'X-Image-Height': { schema: { type: 'integer' } },
        },
        content: {
          'image/jpeg': { schema: { type: 'string', format: 'binary' } },
          'image/png': { schema: { type: 'string', format: 'binary' } },
          'image/webp': { schema: { type: 'string', format: 'binary' } },
          'image/avif': { schema: { type: 'string', format: 'binary' } },
        },
      },
      304: { description: 'Not modified (the `If-None-Match` ETag still matches).' },
    };
  }
  return generated;
}
