type Child = Node | string | null | undefined | false;

/**
 * Minimal element factory. Text is always inserted with `textContent` semantics, never as HTML:
 * error messages and URLs echoed by the API are untrusted and must not be able to inject markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

export function requireElement<T extends HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function replaceContent(target: HTMLElement, ...children: Node[]): void {
  target.replaceChildren(...children);
}
