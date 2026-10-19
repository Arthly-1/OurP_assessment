import type { ProcessParams } from '../api/client.js';
import { CROP_OPTIONS, FORMAT_OPTIONS } from '../api/options.js';
import { h, requireElement } from './dom.js';

export interface FormState {
  url: string;
  width: string;
  height: string;
  format: string;
  quality: string;
  crop: string;
  background: string;
}

export const FIELD_NAMES = [
  'url',
  'width',
  'height',
  'format',
  'quality',
  'crop',
  'background',
] as const;

export const EMPTY_STATE: FormState = {
  url: '',
  width: '',
  height: '',
  format: '',
  quality: '',
  crop: '',
  background: '',
};

const toNumber = (value: string): number | undefined =>
  value.trim() === '' ? undefined : Number(value);

/** Maps raw form text to API parameters. Values are not validated here: the API is the authority. */
export function toParams(state: FormState): ProcessParams {
  return {
    url: state.url.trim(),
    width: toNumber(state.width),
    height: toNumber(state.height),
    format: state.format || undefined,
    quality: toNumber(state.quality),
    crop: state.crop || undefined,
    background: state.background.trim() || undefined,
  };
}

export class TransformForm {
  readonly element: HTMLFormElement;

  constructor() {
    this.element = requireElement<HTMLFormElement>('#transform-form');
    this.fillSelect(
      'format',
      FORMAT_OPTIONS.map(({ value, label }) => ({ value, label })),
    );
    this.fillSelect(
      'crop',
      CROP_OPTIONS.filter((option) => option.value !== 'fill').map(({ value, label }) => ({
        value,
        label,
      })),
    );
    this.input('crop').addEventListener('change', () => this.updateCropHint());
    this.updateCropHint();
  }

  read(): FormState {
    return Object.fromEntries(
      FIELD_NAMES.map((name) => [name, this.input(name).value]),
    ) as unknown as FormState;
  }

  write(state: Partial<FormState>): void {
    for (const name of FIELD_NAMES) this.input(name).value = state[name] ?? '';
    this.updateCropHint();
    this.clearErrors();
  }

  onChange(listener: () => void): void {
    this.element.addEventListener('input', listener);
    this.element.addEventListener('change', listener);
  }

  /** Marks fields the API complained about and shows its message beneath them. */
  showErrors(details: ReadonlyArray<{ param?: string; message: string }>): void {
    this.clearErrors();
    let focused = false;
    for (const detail of details) {
      const field =
        detail.param && this.element.querySelector<HTMLElement>(`[data-field="${detail.param}"]`);
      if (!field) continue;
      const input = field.querySelector<HTMLElement>('input, select');
      const message = field.querySelector<HTMLElement>('.field-error');
      input?.setAttribute('aria-invalid', 'true');
      if (message) {
        message.textContent = detail.message;
        message.hidden = false;
      }
      if (!focused) {
        input?.focus();
        focused = true;
      }
    }
  }

  clearErrors(): void {
    for (const input of this.element.querySelectorAll('[aria-invalid]'))
      input.removeAttribute('aria-invalid');
    for (const message of this.element.querySelectorAll<HTMLElement>('.field-error')) {
      message.hidden = true;
      message.textContent = '';
    }
  }

  private input(name: string): HTMLInputElement & HTMLSelectElement {
    return requireElement<HTMLInputElement & HTMLSelectElement>(`#${name}`, this.element);
  }

  private fillSelect(name: string, options: Array<{ value: string; label: string }>): void {
    this.input(name).replaceChildren(
      ...options.map((option) => h('option', { value: option.value }, option.label)),
    );
  }

  private updateCropHint(): void {
    const selected = CROP_OPTIONS.find((option) => option.value === this.input('crop').value);
    requireElement('#crop-hint').textContent = selected?.hint ?? '';
  }
}

export function stateToSearch(state: FormState): string {
  const search = new URLSearchParams();
  for (const name of FIELD_NAMES) if (state[name]) search.set(name, state[name]);
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function stateFromSearch(search: string): Partial<FormState> {
  const params = new URLSearchParams(search);
  const state: Partial<FormState> = {};
  for (const name of FIELD_NAMES) {
    const value = params.get(name);
    if (value !== null) state[name] = value;
  }
  return state;
}
