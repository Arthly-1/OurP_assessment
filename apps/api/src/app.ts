import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppConfig } from './config/index.js';
import { createContainer, type ContainerOverrides } from './container.js';
import { Errors } from './errors/app-error.js';
import { registerErrorHandling } from './http/plugins/error-handler.js';
import { registerOpenApi } from './http/plugins/openapi.js';
import { registerWebUi } from './http/plugins/web-ui.js';
import { generateRequestId } from './http/request-id.js';
import { healthRoute } from './http/routes/health.route.js';
import { infoRoute } from './http/routes/info.route.js';
import { processRoute } from './http/routes/process.route.js';
import { validatorCompiler } from './http/validation.js';

/** Builds a fully wired Fastify instance. Nothing is listening yet, which keeps tests simple. */
export async function buildApp(
  config: AppConfig,
  overrides: ContainerOverrides = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLoggerOptions(config),
    genReqId: generateRequestId,
    trustProxy: trustedHops(config.server.trustProxyHops),
  }).withTypeProvider<ZodTypeProvider>();

  const container = createContainer(config, overrides);
  app.addHook('onClose', () => container.close());

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    exposedHeaders: [
      'x-request-id',
      'x-cache',
      'x-image-width',
      'x-image-height',
      'etag',
      'retry-after',
    ],
  });
  await registerOpenApi(app, config);

  const routeOptions = { service: container.imageService, config };
  // The expensive endpoints share ONE per-client budget. Health checks, docs and static assets
  // live outside this scope and are never throttled.
  await app.register(async (api) => {
    await api.register(rateLimit, {
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.windowMs,
      errorResponseBuilder: (_request, context) =>
        Errors.rateLimited(Math.max(1, Math.ceil(context.ttl / 1000))),
    });
    await api.register(processRoute, routeOptions);
    await api.register(infoRoute, routeOptions);
  });
  await app.register(healthRoute);
  await registerWebUi(app, config.server.webDistDir);

  return app;
}

function createLoggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  const pretty = {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  };
  return { level: config.server.logLevel, ...(config.env === 'development' ? pretty : {}) };
}

/**
 * Fastify fails closed on a bare hop count, so express it as a function: hop 0 is the socket peer
 * (our reverse proxy); trusting `hops` means believing the `hops` right-most forwarding entries
 * and no more. Entries further left are client-supplied and ignored.
 */
function trustedHops(hops: number): false | ((address: string, hop: number) => boolean) {
  return hops > 0 ? (_address, hop) => hop < hops : false;
}
