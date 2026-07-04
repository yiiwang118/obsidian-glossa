/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
  // Note: previously this also accepted an `html` option that injected markup.
  // That was an XSS footgun (any model-derived text reaching el could inject
  // script) — removed. Callers that genuinely need trusted SVG
  // constants should go through setTrustedSvg().
  const e = activeDocument.createElement(tag);
  if (opts.className) e.className = opts.className;
  if (opts.text != null) e.textContent = opts.text;
  if (opts.title) e.title = opts.title;
  if (opts.type) (e as any).type = opts.type;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.style) setStyle(e, opts.style);
  if (opts.onClick) e.addEventListener('click', opts.onClick);
  if (opts.parent) opts.parent.appendChild(e);
  return e;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setStyle(
  target: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
): void {
  target.setCssStyles(styles);
}

export function setVars(
  target: HTMLElement,
  props: Record<string, string>,
): void {
  target.setCssProps(props);
}

export function setTrustedSvg(target: HTMLElement, svgText: string): void {
  clear(target);
  const svg = parsedTrustedSvg(svgText);
  if (!svg) return;
  const cloned = cloneSvgElement(svg);
  if (cloned) target.appendChild(cloned);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const trustedSvgCache = new Map<string, Element | null>();

function parsedTrustedSvg(svgText: string): Element | null {
  if (trustedSvgCache.has(svgText)) return trustedSvgCache.get(svgText) ?? null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const parsed = svg.localName.toLowerCase() === 'svg' ? svg : null;
  trustedSvgCache.set(svgText, parsed);
  return parsed;
}

function cloneSvgElement(source: Element): SVGElement | null {
  const cloned = activeDocument.createElementNS(SVG_NS, source.localName);
  for (const attr of Array.from(source.attributes)) {
    cloned.setAttribute(attr.name, attr.value);
  }
  for (const child of Array.from(source.childNodes)) {
    const copied = cloneSvgNode(child);
    if (copied) cloned.appendChild(copied);
  }
  return cloned;
}

function cloneSvgNode(source: ChildNode): Node | null {
  if (source.nodeType === 3) return activeDocument.createTextNode(source.textContent ?? '');
  if (source.nodeType !== 1) return null;
  return cloneSvgElement(source as Element);
}

export function debounce<F extends (...a: any[]) => any>(fn: F, ms: number): F {
  let t: any;
  return ((...a: any[]) => { window.clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); }) as F;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
