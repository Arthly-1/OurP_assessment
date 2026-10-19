import './styles.css';
import {
  buildProcessUrl,
  fetchInfo,
  fetchProcessed,
  toCurl,
  type ProcessedImage,
  type SourceInfo,
  ApiError,
} from './api/client.js';
import { h, requireElement } from './ui/dom.js';
import { EMPTY_STATE, TransformForm, stateFromSearch, stateToSearch, toParams } from './ui/form.js';
import { initThemeSwitch } from './ui/theme.js';
import {
  renderError,
  renderOriginalCard,
  renderProcessedCard,
  renderRequestUrl,
} from './ui/views.js';

const form = new TransformForm();
const cards = {
  original: requireElement('#card-original'),
  processed: requireElement('#card-processed'),
};
const errorSlot = requireElement('#error-slot');
const requestUrlEl = requireElement('#request-url');
const submitButton = requireElement<HTMLButtonElement>('#submit');
const copyStatus = requireElement('#copy-status');

let inflight: AbortController | undefined;
let currentObjectUrl: string | undefined;

function currentRequestUrl(): string | undefined {
  const params = toParams(form.read());
  return params.url ? buildProcessUrl(params, window.location.origin) : undefined;
}

function refreshRequestPreview(): void {
  const url = currentRequestUrl();
  renderRequestUrl(requestUrlEl, url);
  for (const id of ['copy-url', 'copy-curl'])
    requireElement<HTMLButtonElement>(`#${id}`).disabled = !url;
  history.replaceState(null, '', `${window.location.pathname}${stateToSearch(form.read())}`);
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? 'Processing…' : 'Process image';
}

async function run(): Promise<void> {
  const params = toParams(form.read());
  form.clearErrors();

  if (!params.url) {
    renderError(
      errorSlot,
      new ApiError('invalid_parameter', 'Enter the URL of an image to process.', 400, [
        { param: 'url', message: 'url is required' },
      ]),
    );
    form.showErrors([{ param: 'url', message: 'Enter the URL of an image to process.' }]);
    return;
  }

  inflight?.abort(); // a newer request supersedes an in-flight one
  const controller = (inflight = new AbortController());
  renderError(errorSlot, null);
  renderOriginalCard(cards.original, { kind: 'loading' });
  renderProcessedCard(cards.processed, { kind: 'loading' });
  setBusy(true);

  // Same public endpoints any API consumer would use; the source is fetched once server-side.
  const [processed, info] = await Promise.allSettled([
    fetchProcessed(params, { signal: controller.signal }),
    fetchInfo(params.url, { signal: controller.signal }),
  ]);
  if (controller.signal.aborted) return;
  setBusy(false);

  const original: SourceInfo | undefined = info.status === 'fulfilled' ? info.value : undefined;
  renderOriginalCard(cards.original, {
    kind: 'ready',
    data: {
      url: params.url,
      info: original,
      ...(info.status === 'rejected' && { infoError: describe(info.reason) }),
    },
  });

  if (processed.status === 'fulfilled') {
    showProcessed(processed.value, original);
  } else {
    renderProcessedCard(cards.processed, { kind: 'unavailable', reason: 'No image was produced.' });
    renderError(errorSlot, processed.reason);
    if (processed.reason instanceof ApiError) form.showErrors(processed.reason.details);
    // The original cannot be shown if the API could not even fetch it.
    if (info.status === 'rejected')
      renderOriginalCard(cards.original, {
        kind: 'unavailable',
        reason: 'The source image could not be loaded.',
      });
  }
}

function showProcessed(image: ProcessedImage, original: SourceInfo | undefined): void {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = image.objectUrl;
  renderProcessedCard(cards.processed, { kind: 'ready', data: { image, original } });
}

const describe = (reason: unknown): string =>
  reason instanceof Error ? reason.message : 'Unknown error';

async function copy(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = `${label} copied to clipboard`;
  } catch {
    const area = h('textarea', { 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    copyStatus.textContent = ok ? `${label} copied to clipboard` : `Could not copy ${label}`;
  }
  flash(label === 'URL' ? '#copy-url' : '#copy-curl');
}

function flash(selector: string): void {
  const button = requireElement<HTMLButtonElement>(selector);
  const original = button.dataset.label ?? button.textContent ?? '';
  button.dataset.label = original;
  button.textContent = 'Copied ✓';
  window.setTimeout(() => (button.textContent = original), 1500);
}

function init(): void {
  initThemeSwitch(requireElement('#theme-switch'));
  form.write({ ...EMPTY_STATE, ...stateFromSearch(window.location.search) });
  renderOriginalCard(cards.original, { kind: 'empty' });
  renderProcessedCard(cards.processed, { kind: 'empty' });
  refreshRequestPreview();

  form.onChange(refreshRequestPreview);
  form.element.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
  requireElement('#reset').addEventListener('click', () => {
    inflight?.abort();
    setBusy(false);
    form.write(EMPTY_STATE);
    renderError(errorSlot, null);
    renderOriginalCard(cards.original, { kind: 'empty' });
    renderProcessedCard(cards.processed, { kind: 'empty' });
    refreshRequestPreview();
  });
  requireElement('#copy-url').addEventListener('click', () => {
    const url = currentRequestUrl();
    if (url) void copy(url, 'URL');
  });
  requireElement('#copy-curl').addEventListener('click', () => {
    const url = currentRequestUrl();
    if (url) void copy(toCurl(url, form.read().format), 'curl command');
  });

  // A shared link (?url=...) runs immediately.
  if (toParams(form.read()).url) void run();
}

init();
