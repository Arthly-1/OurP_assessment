import { ApiError, formatBytes, type ProcessedImage, type SourceInfo } from '../api/client.js';
import { h } from './dom.js';

export type CardState<T> =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'unavailable'; reason: string };

const FORMAT_LABELS: Record<string, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  gif: 'GIF',
};

export const formatLabel = (format: string): string =>
  FORMAT_LABELS[format] ?? format.toUpperCase();
const formatFromMime = (mime: string): string =>
  formatLabel(mime.replace(/^image\//, '').replace('jpg', 'jpeg'));

function cardShell(
  titleId: string,
  title: string,
  badge: string | undefined,
  ...body: Array<Node | null>
): Node[] {
  return [
    h(
      'div',
      { class: 'card-head' },
      h('h3', { id: titleId }, title),
      badge ? h('span', { class: 'badge badge-format' }, badge) : null,
    ),
    ...body.filter((node): node is Node => node !== null),
  ];
}

function meta(rows: Array<[label: string, value: Node | string]>): HTMLElement {
  return h(
    'dl',
    { class: 'meta' },
    ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)]),
  );
}

const placeholder = (text: string, icon = true) =>
  h(
    'div',
    { class: 'placeholder' },
    icon ? h('span', { class: 'placeholder-icon', 'aria-hidden': 'true' }, '🖼') : null,
    h('span', {}, text),
  );
const skeleton = () =>
  h(
    'div',
    { class: 'skeleton', role: 'status', 'aria-label': 'Loading' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
  );

type OriginalData = { url: string; info: SourceInfo | undefined; infoError?: string };

export function renderOriginalCard(card: HTMLElement, state: CardState<OriginalData>): void {
  card.setAttribute('aria-busy', String(state.kind === 'loading'));
  const shell = (badge: string | undefined, ...body: Array<Node | null>) =>
    card.replaceChildren(...cardShell('original-title', 'Original', badge, ...body));

  if (state.kind === 'empty') {
    return shell(undefined, placeholder('Your source image will appear here.'));
  }
  if (state.kind === 'loading') return shell(undefined, skeleton());
  if (state.kind === 'unavailable') return shell(undefined, placeholder(state.reason));

  const { url, info, infoError } = state.data;
  const image = h('img', {
    alt: 'Original source image',
    src: url,
    referrerpolicy: 'no-referrer',
    decoding: 'async',
  });
  const frame = h('div', { class: 'frame checkerboard is-loading' }, image);
  image.addEventListener('load', () => frame.classList.remove('is-loading'));
  image.addEventListener('error', () => {
    frame.replaceChildren(
      placeholder(
        'The browser could not display this URL directly (the host may block hotlinking). Metadata below comes from the API.',
      ),
    );
  });

  const details = info
    ? meta([
        ['Dimensions', `${info.width} × ${info.height} px`],
        [
          'Format',
          formatLabel(info.format) + (info.animated ? ' (animated, first frame used)' : ''),
        ],
        ['File size', formatBytes(info.bytes)],
      ])
    : h('p', { class: 'hint' }, infoError ?? 'Source details are unavailable.');
  shell(info ? formatLabel(info.format) : undefined, frame, details);
}

type ProcessedData = { image: ProcessedImage; original: SourceInfo | undefined };

export function renderProcessedCard(card: HTMLElement, state: CardState<ProcessedData>): void {
  card.setAttribute('aria-busy', String(state.kind === 'loading'));
  const shell = (badge: string | undefined, ...body: Array<Node | null>) =>
    card.replaceChildren(...cardShell('processed-title', 'Processed', badge, ...body));

  if (state.kind === 'empty') {
    return shell(undefined, placeholder('Set some transformations and press “Process image”.'));
  }
  if (state.kind === 'loading') return shell(undefined, skeleton());
  if (state.kind === 'unavailable') return shell(undefined, placeholder(state.reason));

  const { image, original } = state.data;
  const rows: Array<[string, Node | string]> = [
    ['Dimensions', image.width && image.height ? `${image.width} × ${image.height} px` : 'unknown'],
    ['Format', formatFromMime(image.contentType)],
    ['File size', fileSize(image.bytes, original?.bytes)],
    [
      'Served from',
      image.cache === 'HIT' ? 'cache (HIT)' : image.cache === 'MISS' ? 'fresh (MISS)' : 'unknown',
    ],
    ['Round trip', `${image.durationMs} ms`],
  ];
  const picture = h('img', { alt: 'Processed image', src: image.objectUrl, decoding: 'async' });
  shell(
    formatFromMime(image.contentType),
    h('div', { class: 'frame checkerboard' }, picture),
    meta(rows),
  );
}

/** File size plus a coloured pill showing the change against the original. */
function fileSize(processed: number, original: number | undefined): Node {
  const text = h('span', {}, formatBytes(processed));
  if (!original) return text;
  const change = Math.round(((processed - original) / original) * 100);
  if (change === 0) return text;
  const smaller = change < 0;
  return h(
    'span',
    {},
    text,
    ' ',
    h(
      'span',
      { class: smaller ? 'pill pill-good' : 'pill pill-warn' },
      `${smaller ? '' : '+'}${change}% vs original`,
    ),
  );
}

/**
 * Renders the request URL with light syntax colouring. The element's text content is still the
 * exact URL, so selecting and copying it by hand works as expected.
 */
export function renderRequestUrl(target: HTMLElement, url: string | undefined): void {
  target.classList.toggle('is-empty', !url);
  if (!url) {
    target.textContent = 'Enter a source image URL to see the request that will be made.';
    return;
  }
  const queryStart = url.indexOf('?');
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : url.slice(queryStart + 1);

  const parts: Node[] = [h('span', { class: 'tok-path' }, path)];
  query.split('&').forEach((pair, index) => {
    const equals = pair.indexOf('=');
    parts.push(
      h('span', { class: 'tok-punct' }, index === 0 ? '?' : '&'),
      h('span', { class: 'tok-key' }, equals === -1 ? pair : pair.slice(0, equals)),
    );
    if (equals !== -1) {
      parts.push(
        h('span', { class: 'tok-punct' }, '='),
        h('span', { class: 'tok-value' }, pair.slice(equals + 1)),
      );
    }
  });
  target.replaceChildren(...parts);
}

const TITLES: Record<string, string> = {
  invalid_parameter: 'Some parameters need fixing',
  url_not_allowed: 'That URL can’t be fetched',
  source_not_found: 'Source image not found',
  source_unreachable: 'Couldn’t reach the source',
  source_error: 'The source server returned an error',
  source_timeout: 'The source took too long',
  source_too_large: 'Source image is too large',
  unsupported_media_type: 'Not a supported image',
  invalid_image: 'The image couldn’t be processed',
  output_too_large: 'Requested output is too large',
  rate_limited: 'Slow down a little',
  overloaded: 'The service is busy',
  network_error: 'Can’t reach the API',
  internal_error: 'Something went wrong on our side',
};

const HINTS: Record<string, string> = {
  invalid_parameter: 'Fix the highlighted fields and try again.',
  url_not_allowed:
    'Only public http(s) URLs on ports 80 and 443 are fetched; private and internal addresses are blocked.',
  source_not_found: 'Check the URL: the origin server answered 404/410.',
  source_error:
    'If this says 401 or 403, the image is private or blocks downloads. Use a URL that opens without logging in.',
  source_unreachable: 'Check the hostname and that the server is online.',
  source_timeout: 'The origin did not respond in time. Try again, or use a faster host.',
  source_too_large: 'Use a smaller source file.',
  unsupported_media_type: 'Supported inputs: JPEG, PNG, WebP, GIF and AVIF. SVG is not supported.',
  invalid_image: 'The file may be corrupt or truncated.',
  output_too_large: 'Provide both width and height, or lower them.',
};

const FIELD_IDS = new Set(['url', 'width', 'height', 'format', 'quality', 'crop', 'background']);

export function renderError(slot: HTMLElement, error: unknown): void {
  if (error === null) return slot.replaceChildren();

  const apiError = error instanceof ApiError ? error : undefined;
  const code = apiError?.code ?? 'internal_error';
  const message =
    apiError?.message ?? (error instanceof Error ? error.message : 'Unexpected error.');
  const unattached = (apiError?.details ?? []).filter(
    (detail) => !detail.param || !FIELD_IDS.has(detail.param),
  );
  const retry = apiError?.retryAfterSeconds
    ? `Retry in about ${apiError.retryAfterSeconds}s.`
    : undefined;
  const hint = HINTS[code];

  slot.replaceChildren(
    h(
      'div',
      { class: 'panel error-banner', role: 'alert' },
      h('span', { class: 'error-icon', 'aria-hidden': 'true' }, '!'),
      h(
        'div',
        { class: 'error-body' },
        h(
          'div',
          { class: 'error-title' },
          h('strong', {}, TITLES[code] ?? 'Request failed'),
          h(
            'span',
            { class: 'badge badge-error' },
            apiError && apiError.status ? `${apiError.status} ${code}` : code,
          ),
        ),
        h('p', {}, message),
        unattached.length > 0 &&
          h(
            'ul',
            {},
            ...unattached.map((detail) =>
              h('li', {}, detail.param ? `${detail.param}: ${detail.message}` : detail.message),
            ),
          ),
        (hint || retry) && h('p', { class: 'hint' }, [hint, retry].filter(Boolean).join(' ')),
        apiError?.requestId && h('p', { class: 'hint mono' }, `Request ID: ${apiError.requestId}`),
      ),
    ),
  );
}
