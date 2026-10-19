import { z } from 'zod';

export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** What callers may pass as `format`. `jpg` is an alias; `auto` negotiates via the Accept header. */
export const FORMAT_PARAMS = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'auto'] as const;
export type FormatParam = (typeof FORMAT_PARAMS)[number];

export const CROP_MODES = ['fill', 'fit', 'scale', 'limit', 'pad'] as const;
export type CropMode = (typeof CROP_MODES)[number];

export const DEFAULT_CROP_MODE: CropMode = 'fill';

export interface QueryLimits {
  maxDimension: number;
}

const intParam = (name: string, min: number, max: number) => {
  const message = `${name} must be a whole number between ${min} and ${max}`;
  return z.coerce
    .number({ error: message })
    .int({ error: message })
    .min(min, { error: message })
    .max(max, { error: message });
};

const enumParam = <const T extends readonly [string, ...string[]]>(name: string, values: T) =>
  z.enum(values, { error: `${name} must be one of: ${values.join(', ')}` });

/**
 * Query-string contract for `GET /process`. Built from a factory so documented limits always
 * match the configured ones. Unknown parameters are rejected rather than ignored: a silently
 * ignored typo (`widht=500`) is the most frustrating kind of API bug.
 */
export function createProcessQuerySchema({ maxDimension }: QueryLimits) {
  return z.strictObject({
    url: z
      .string({ error: 'url is required: the absolute http(s) address of the source image' })
      .min(1, { error: 'url is required: the absolute http(s) address of the source image' })
      .meta({ description: 'Absolute http(s) URL of the source image (URL-encode it).' }),
    width: intParam('width', 1, maxDimension)
      .optional()
      .meta({ description: 'Target width in pixels. Omit to derive from height / keep original.' }),
    height: intParam('height', 1, maxDimension)
      .optional()
      .meta({ description: 'Target height in pixels. Omit to derive from width / keep original.' }),
    format: enumParam('format', FORMAT_PARAMS).optional().meta({
      description:
        'Output format. Defaults to the source format (GIF becomes PNG). `auto` picks WebP when the Accept header allows it.',
    }),
    quality: intParam('quality', 1, 100).optional().meta({
      description:
        'Encoder quality 1-100 (default 80; 50 for AVIF). For PNG it enables lossy palette quantization.',
    }),
    crop: enumParam('crop', CROP_MODES)
      .optional()
      .meta({
        description:
          'How to fit the image into width x height. fill: cover and crop the overflow (default). ' +
          'fit: scale to fit inside, keep aspect ratio. limit: like fit but never upscale. ' +
          'scale: stretch to exactly width x height. pad: fit inside and pad to width x height.',
      }),
    background: z
      .string()
      .regex(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
        error: 'background must be a 3 or 6 digit hex colour without "#", e.g. ffffff',
      })
      .optional()
      .meta({
        description:
          'Hex colour (no "#") for crop=pad and for flattening transparency when the output is JPEG. Default: transparent, or white for JPEG.',
      }),
  });
}

export type ProcessQuery = z.infer<ReturnType<typeof createProcessQuerySchema>>;

export const infoQuerySchema = z.strictObject({
  url: z
    .string({ error: 'url is required: the absolute http(s) address of the source image' })
    .min(1, { error: 'url is required: the absolute http(s) address of the source image' })
    .meta({ description: 'Absolute http(s) URL of the source image (URL-encode it).' }),
});
export type InfoQuery = z.infer<typeof infoQuerySchema>;
