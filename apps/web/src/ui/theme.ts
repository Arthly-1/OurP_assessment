export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-preference';
const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (PREFERENCES.includes(stored as ThemePreference)) return stored as ThemePreference;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies): fall back to the OS setting.
  }
  return 'system';
}

const darkQuery = (): MediaQueryList | undefined =>
  window.matchMedia?.('(prefers-color-scheme: dark)');

function prefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/** Resolves the preference to a concrete theme and reflects it on <html> for the stylesheet. */
function apply(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && prefersDark());
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themePref = preference;
}

/**
 * Wires the light / dark / system switch. The initial theme is already applied by a tiny inline
 * script in <head> (to avoid a flash of the wrong theme); this adds interaction and keeps
 * "system" in sync when the OS setting changes.
 */
export function initThemeSwitch(container: HTMLElement): void {
  let preference = readPreference();
  apply(preference);

  const buttons = container.querySelectorAll<HTMLButtonElement>('[data-theme-option]');
  const reflect = () => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.themeOption === preference));
    }
  };
  reflect();

  for (const button of buttons) {
    button.addEventListener('click', () => {
      preference = button.dataset.themeOption as ThemePreference;
      try {
        localStorage.setItem(STORAGE_KEY, preference);
      } catch {
        // Not persisted, but the choice still applies for this visit.
      }
      apply(preference);
      reflect();
    });
  }

  darkQuery()?.addEventListener('change', () => {
    if (preference === 'system') apply('system');
  });
}
