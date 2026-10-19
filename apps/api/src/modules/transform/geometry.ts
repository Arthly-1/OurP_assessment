import type { CropMode } from './options.js';

export interface Size {
  width: number;
  height: number;
}

export interface ResizeIntent {
  width?: number | undefined;
  height?: number | undefined;
  crop: CropMode;
}

/**
 * Predicts the output dimensions *before* decoding, so oversize requests are rejected cheaply.
 * Notably, `width=4096` on a 1x10000 source is within the per-parameter limits yet would yield
 * a 4096x40960000 image if the height were derived blindly.
 */
export function resolveOutputSize(source: Size, { width, height, crop }: ResizeIntent): Size {
  if (width === undefined && height === undefined) return source;

  let result: Size;
  if (width !== undefined && height !== undefined) {
    if (crop === 'fit' || crop === 'limit') {
      const factor = Math.min(width / source.width, height / source.height);
      result = scaleBy(source, factor);
    } else {
      result = { width, height }; // fill, scale, pad produce the exact box
    }
  } else {
    const factor = width !== undefined ? width / source.width : (height as number) / source.height;
    result = scaleBy(source, factor);
  }

  // `limit` never upscales.
  if (crop === 'limit' && (result.width > source.width || result.height > source.height)) {
    return source;
  }
  return result;
}

function scaleBy(size: Size, factor: number): Size {
  return {
    width: Math.max(1, Math.round(size.width * factor)),
    height: Math.max(1, Math.round(size.height * factor)),
  };
}
