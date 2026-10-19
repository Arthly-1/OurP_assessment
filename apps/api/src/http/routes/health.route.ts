import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { healthSchema } from '../schemas.js';

export const healthRoute: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Liveness / readiness check',
        response: { 200: healthSchema },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return { status: 'ok' as const, uptimeSeconds: Math.floor(process.uptime()) };
    },
  );
};
