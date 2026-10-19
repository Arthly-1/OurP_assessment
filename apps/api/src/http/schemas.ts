import { z } from 'zod';
import { INPUT_FORMATS } from '../modules/source/image-sniffer.js';

const detailSchema = z.object({
  param: z.string().optional().meta({ description: 'The query parameter at fault, if any.' }),
  message: z.string(),
});

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({
        description:
          'Stable, machine-readable code, e.g. invalid_parameter, url_not_allowed, source_not_found, source_timeout, source_too_large, unsupported_media_type, invalid_image, output_too_large, rate_limited, overloaded.',
        examples: ['invalid_parameter'],
      }),
      message: z.string().meta({ description: 'Human-readable explanation of what to fix.' }),
      status: z.number().int().meta({ description: 'Mirrors the HTTP status code.' }),
      requestId: z.string().meta({ description: 'Quote this when reporting a problem.' }),
      details: z.array(detailSchema).optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const imageInfoSchema = z
  .object({
    width: z.number().int(),
    height: z.number().int(),
    format: z.enum(INPUT_FORMATS),
    bytes: z.number().int().meta({ description: 'Size of the source file in bytes.' }),
    contentType: z.string().nullable().meta({ description: 'Content-Type sent by the origin.' }),
    hasAlpha: z.boolean(),
    animated: z
      .boolean()
      .meta({ description: 'Animated sources are processed as their first frame.' }),
  })
  .meta({ id: 'ImageInfo' });

export const healthSchema = z
  .object({
    status: z.literal('ok'),
    uptimeSeconds: z.number().int(),
  })
  .meta({ id: 'Health' });

/** Error statuses every image endpoint can produce, documented once. */
export const errorResponses = {
  400: errorResponseSchema,
  404: errorResponseSchema,
  413: errorResponseSchema,
  415: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
  502: errorResponseSchema,
  503: errorResponseSchema,
  504: errorResponseSchema,
};
