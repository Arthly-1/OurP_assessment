/**
 * Option lists mirror the API contract (see /openapi.json). They are duplicated here rather than
 * shared at build time to keep the UI a plain consumer of the public API; generating them from the
 * OpenAPI document is a natural next step.
 */
export interface Option {
  value: string;
  label: string;
}

export const FORMAT_OPTIONS: readonly Option[] = [
  { value: '', label: 'Same as source' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'auto', label: 'Auto (WebP if supported)' },
];

export const CROP_OPTIONS: ReadonlyArray<Option & { hint: string }> = [
  {
    value: '',
    label: 'fill (default)',
    hint: 'Cover the width × height box and crop the overflow. Output is exactly the requested size.',
  },
  {
    value: 'fill',
    label: 'fill',
    hint: 'Cover the width × height box and crop the overflow. Output is exactly the requested size.',
  },
  {
    value: 'fit',
    label: 'fit',
    hint: 'Scale to fit inside the box, keeping the aspect ratio. Output may be smaller than the box in one dimension.',
  },
  {
    value: 'limit',
    label: 'limit',
    hint: 'Like fit, but never enlarges an image that is already smaller than the box.',
  },
  {
    value: 'scale',
    label: 'scale',
    hint: 'Stretch to exactly width × height, ignoring the aspect ratio.',
  },
  {
    value: 'pad',
    label: 'pad',
    hint: 'Fit inside the box, then pad with the background colour to exactly width × height.',
  },
];
