/** Input formats we are willing to hand to the image decoder. */
export const INPUT_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'avif'] as const;
export type InputFormat = (typeof INPUT_FORMATS)[number];

export function sniffImageFormat(data: Uint8Array): InputFormat | undefined {
  if (startsWith(data, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(data, 0, [0x47, 0x49, 0x46, 0x38]) && (data[4] === 0x37 || data[4] === 0x39)) {
    return 'gif'; // "GIF87a" / "GIF89a"
  }
  if (startsWith(data, 0, ascii('RIFF')) && startsWith(data, 8, ascii('WEBP'))) return 'webp';
  if (startsWith(data, 4, ascii('ftyp'))) {
    const brand = String.fromCharCode(...Array.from(data.subarray(8, 12)));
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return undefined;
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function startsWith(data: Uint8Array, offset: number, signature: number[]): boolean {
  return (
    data.length >= offset + signature.length && signature.every((b, i) => data[offset + i] === b)
  );
}
