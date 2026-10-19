import type { FastifySchemaCompiler } from 'fastify';
import { z } from 'zod';
import { Errors, type ErrorDetail } from '../errors/app-error.js';

/**
 * Validates request data with the route's Zod schema and reports failures as the API's own
 * `invalid_parameter` error (one entry per offending parameter), instead of Fastify's default
 * validation error shape.
 */
export const validatorCompiler: FastifySchemaCompiler<z.ZodType> =
  ({ schema }) =>
  (data) => {
    const result = schema.safeParse(data);
    if (result.success) return { value: result.data };
    return { error: Errors.invalidParameter(toDetails(result.error, schema)) };
  };

function toDetails(error: z.ZodError, schema: z.ZodType): ErrorDetail[] {
  const supported = schema instanceof z.ZodObject ? Object.keys(schema.shape).join(', ') : '';
  const details = new Map<string, ErrorDetail>();

  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        details.set(key, {
          param: key,
          message: `Unknown parameter "${key}".${supported ? ` Supported parameters: ${supported}.` : ''}`,
        });
      }
      continue;
    }
    const param = typeof issue.path[0] === 'string' ? issue.path[0] : undefined;
    const key = param ?? issue.message;
    if (!details.has(key))
      details.set(key, param ? { param, message: issue.message } : { message: issue.message });
  }
  return [...details.values()];
}
