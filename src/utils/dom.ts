/** Tiny DOM helpers. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: Partial<{
    className: string;
    text: string;
    title: string;
    type: string;
    parent: HTMLElement;
    onClick: (e: MouseEvent) => void;
    attrs: Record<string, string>;
    style: Partial<CSSStyleDeclaration>;
  }> = {}
): HTMLElementTagNameMap[K] {
  // Note: previously this also accepted an `html` option that called
  // innerHTML. That was an XSS footgun (any model-derived text reaching el
  // could inject script) — removed. Callers that genuinely need raw HTML
  // injection (e.g. SVG icons) must do `target.innerHTML = trustedStr`
  // explicitly so the unsafety is visible at the call site.
  const e = document.createElement(tag);
  if (opts.className) e.className = opts.className;
  if (opts.text != null) e.textContent = opts.text;
  if (opts.title) e.title = opts.title;
  if (opts.type) (e as any).type = opts.type;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.style) Object.assign(e.style, opts.style);
  if (opts.onClick) e.addEventListener('click', opts.onClick);
  if (opts.parent) opts.parent.appendChild(e);
  return e;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function debounce<F extends (...a: any[]) => any>(fn: F, ms: number): F {
  let t: any;
  return ((...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as F;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
