import sharp, { type FitEnum, type Metadata, type Sharp } from 'sharp';
import { Errors } from '../../errors/app-error.js';
import type { InputFormat } from '../source/image-sniffer.js';
import { resolveOutputSize, type Size } from './geometry.js';
import type { CropMode, OutputFormat } from './options.js';

export interface TransformerLimits {
  maxPixels: number;
  maxDimension: number;
}

export interface TransformRequest {
  width?: number | undefined;
  height?: number | undefined;
  crop: CropMode;
  format: OutputFormat;
  quality?: number | undefined;
  /** 3 or 6 digit hex, no "#". */
  background?: string | undefined;
}

export interface TransformResult extends Size {
  data: Buffer;
  format: OutputFormat;
}

export interface ImageMetadata extends Size {
  format: InputFormat;
  hasAlpha: boolean;
  /** True when the source has several frames; only the first is processed. */
  animated: boolean;
}

const RESIZE_FIT = {
  fill: 'cover',
  fit: 'inside',
  limit: 'inside',
  scale: 'fill',
  pad: 'contain',
} as const satisfies Record<CropMode, keyof FitEnum>;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** Thin, well-bounded wrapper around sharp: all decoding and encoding goes through here. */
export class ImageTransformer {
  constructor(private readonly limits: TransformerLimits) {}

  /** Reads header-level metadata without decoding pixels. */
  async inspect(data: Buffer): Promise<ImageMetadata> {
    let meta: Metadata;
    try {
      meta = await sharp(data).metadata();
    } catch (error) {
      throw Errors.invalidImage(`The image could not be read: ${reason(error)}`);
    }
    if (!meta.width || !meta.height || !meta.format) {
      throw Errors.invalidImage('The image has no readable dimensions.');
    }

    // EXIF orientations 5-8 are rotated by 90 degrees when displayed.
    const rotated = (meta.orientation ?? 1) >= 5;
    const size = rotated
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height };

    if (size.width * size.height > this.limits.maxPixels) {
      throw Errors.invalidImage(
        `The source image is ${size.width}x${size.height} (${megapixels(size.width * size.height)} MP); ` +
          `the maximum is ${megapixels(this.limits.maxPixels)} MP.`,
      );
    }

    return {
      ...size,
      format: meta.format as InputFormat,
      hasAlpha: meta.hasAlpha ?? false,
      animated: (meta.pages ?? 1) > 1,
    };
  }

  async transform(
    data: Buffer,
    request: TransformRequest,
    source?: ImageMetadata,
  ): Promise<TransformResult> {
    const metadata = source ?? (await this.inspect(data));
    const target = resolveOutputSize(metadata, request);
    if (target.width > this.limits.maxDimension || target.height > this.limits.maxDimension) {
      throw Errors.outputTooLarge(this.limits.maxDimension, target.width, target.height);
    }

    const background = request.background ? parseHexColour(request.background) : undefined;

    let pipeline = sharp(data, {
      limitInputPixels: this.limits.maxPixels,
      failOn: 'error',
      sequentialRead: true,
    }).rotate(); // apply EXIF orientation; output metadata (EXIF/GPS) is stripped by default

    if (request.width !== undefined || request.height !== undefined) {
      pipeline = pipeline.resize({
        width: target.width,
        height: target.height,
        fit: RESIZE_FIT[request.crop],
        background: background ?? TRANSPARENT,
      });
    }
    if (request.format === 'jpeg') {
      pipeline = pipeline.flatten({ background: background ?? WHITE });
    }

    try {
      const { data: output, info } = await encode(pipeline, request).toBuffer({
        resolveWithObject: true,
      });
      return { data: output, format: request.format, width: info.width, height: info.height };
    } catch (error) {
      throw Errors.invalidImage(`The image could not be processed: ${reason(error)}`);
    }
  }
}

function encode(pipeline: Sharp, { format, quality }: TransformRequest): Sharp {
  switch (format) {
    case 'jpeg':
      return pipeline.jpeg({ quality: quality ?? 80, progressive: true });
    case 'webp':
      return pipeline.webp({ quality: quality ?? 80 });
    case 'avif':
      return pipeline.avif({ quality: quality ?? 50 });
    case 'png':
      // PNG is lossless; `quality` opts in to palette quantization.
      return quality === undefined
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.png({ palette: true, quality, compressionLevel: 9 });
  }
}

function parseHexColour(hex: string): { r: number; g: number; b: number; alpha: number } {
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    alpha: 1,
  };
}

function megapixels(pixels: number): string {
  return (pixels / 1_000_000).toFixed(1);
}

function reason(error: unknown): string {
  return error instanceof Error
    ? (error.message.split('\n')[0] ?? 'unknown error')
    : 'unknown error';
}
