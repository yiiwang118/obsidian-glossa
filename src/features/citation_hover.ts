/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { FileView, TFile } from 'obsidian';
import type GlossaPlugin from '../main';
import { el, clear, setStyle } from '../utils/dom';
import {
  PdfReferenceIndexCache,
  lookupCitation,
  parseCitationText,
  type CitationLookup,
  type ParsedCitation,
  type PdfReferenceEntry,
} from '../citations/pdf_reference_index';

interface HoverCandidate {
  file: TFile;
  root: HTMLElement;
  anchor: HTMLElement;
  citation: ParsedCitation;
}

const PDF_ROOT_SELECTOR = [
  '.pdf-viewer',
  '.pdf-container',
  '.pdfViewer',
  '.pdf-embed',
  '.workspace-leaf-content[data-type="pdf"]',
].join(',');

const LINK_SELECTOR = 'a, [role="link"], .linkAnnotation, .annotationLayer section';

export class CitationHoverController {
  private enabled = false;
  private popupEl: HTMLElement | null = null;
  private activeCandidate: HoverCandidate | null = null;
  private hoverTimer: number | null = null;
  private hideTimer: number | null = null;
  private seq = 0;
  private aborter: AbortController | null = null;
  private cache = new PdfReferenceIndexCache();

  private pointerOverHandler = (e: PointerEvent) => this.onPointerOver(e);
  private mouseOverHandler = (e: MouseEvent) => this.onHoverEvent(e);
  private scrollHandler = (e: Event) => {
    if (this.popupEl?.contains(e.target as Node)) return;
    this.hide();
  };
  private keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.hide();
  };
  private mouseDownHandler = (e: MouseEvent) => {
    if (this.popupEl?.contains(e.target as Node)) return;
    this.hide();
  };

  constructor(private plugin: GlossaPlugin) {}

  syncFromSettings(): void {
    const shouldEnable = !!this.plugin.settings.citationHoverEnabled;
    if (shouldEnable === this.enabled) return;
    this.enabled = shouldEnable;
    if (shouldEnable) this.install();
    else this.destroy();
  }

  destroy(): void {
    this.enabled = false;
    this.clearTimer();
    this.clearHideTimer();
    this.abortActive();
    this.removeListeners();
    this.popupEl?.remove();
    this.popupEl = null;
    this.activeCandidate = null;
    this.cache.clear();
  }

  private install(): void {
    activeDocument.addEventListener('pointerover', this.pointerOverHandler, true);
    activeDocument.addEventListener('mouseover', this.mouseOverHandler, true);
    activeDocument.addEventListener('scroll', this.scrollHandler, true);
    activeDocument.addEventListener('keydown', this.keyHandler, true);
    activeDocument.addEventListener('mousedown', this.mouseDownHandler, true);
  }

  private removeListeners(): void {
    activeDocument.removeEventListener('pointerover', this.pointerOverHandler, true);
    activeDocument.removeEventListener('mouseover', this.mouseOverHandler, true);
    activeDocument.removeEventListener('scroll', this.scrollHandler, true);
    activeDocument.removeEventListener('keydown', this.keyHandler, true);
    activeDocument.removeEventListener('mousedown', this.mouseDownHandler, true);
  }

  private onPointerOver(e: PointerEvent): void {
    this.onHoverEvent(e);
  }

  private onHoverEvent(e: MouseEvent | PointerEvent): void {
    if (!this.enabled) return;
    if (this.popupEl?.contains(e.target as Node)) {
      this.clearHideTimer();
      return;
    }
    if (this.plugin.settings.citationHoverRequireModifier && !e.altKey) {
      this.hide();
      return;
    }

    const candidate = this.candidateFromEvent(e);
    if (!candidate) {
      if (this.isPointerNearActiveCandidate(e)) {
        this.clearHideTimer();
        return;
      }
      this.hideSoon();
      return;
    }

    this.clearHideTimer();
    if (
      this.activeCandidate &&
      this.activeCandidate.file.path === candidate.file.path &&
      this.activeCandidate.anchor === candidate.anchor &&
      this.activeCandidate.citation.raw === candidate.citation.raw
    ) return;

    this.activeCandidate = candidate;
    this.schedule(candidate);
  }

  private schedule(candidate: HoverCandidate): void {
    this.clearTimer();
    this.abortActive();
    const seq = ++this.seq;
    const delay = Math.max(250, Math.min(2000, this.plugin.settings.citationHoverDelayMs ?? 700));
    this.hoverTimer = window.setTimeout(() => {
      this.hoverTimer = null;
      this.resolveCandidate(candidate, seq).catch((e) => {
        if (seq !== this.seq) return;
        const msg = e?.name === 'AbortError' ? '' : (e?.message ?? String(e));
        if (msg) this.showMessage(candidate, 'Reference preview failed', msg);
      });
    }, delay);
  }

  private async resolveCandidate(candidate: HoverCandidate, seq: number): Promise<void> {
    const ctl = new AbortController();
    this.aborter = ctl;
    const index = await this.cache.get(this.plugin.app, candidate.file, ctl.signal);
    if (seq !== this.seq || ctl.signal.aborted) return;
    const lookup = lookupCitation(index, candidate.citation);
    this.renderLookup(candidate, lookup);
  }

  private candidateFromEvent(e: MouseEvent | PointerEvent): HoverCandidate | null {
    const target = closestHTMLElement(e.target);
    if (!target) return null;

    const ctx = this.pdfContextForTarget(target);
    if (!ctx) return null;

    const link = target.closest(LINK_SELECTOR);
    if (!link || !ctx.root.contains(link)) return null;
    const anchor = link as HTMLElement;
    const candidates = this.textCandidatesFor(anchor, target, ctx.root, e);
    const citation = candidates.map(text => parseCitationText(text)).find(Boolean);
    if (!citation) return null;
    return { file: ctx.file, root: ctx.root, anchor, citation };
  }

  private pdfContextForTarget(target: HTMLElement): { file: TFile; root: HTMLElement } | null {
    const directRoot = target.closest(PDF_ROOT_SELECTOR);
    const leaves: any[] = [];
    this.plugin.app.workspace.iterateAllLeaves(leaf => leaves.push(leaf));
    for (const leaf of leaves) {
      const view = leaf?.view;
      const container = (view)?.containerEl as HTMLElement | undefined;
      if (!view || !container || !container.contains(target)) continue;
      const file = view instanceof FileView ? view.file : (view).file;
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') continue;
      const root = directRoot && container.contains(directRoot)
        ? directRoot as HTMLElement
        : container;
      return { file, root };
    }
    return null;
  }

  private textCandidatesFor(anchor: HTMLElement, target: HTMLElement, root: HTMLElement, e: MouseEvent | PointerEvent): string[] {
    const values: string[] = [];

    const lineText = citationTokenNearPoint(root, anchor.getBoundingClientRect(), e.clientX);
    if (lineText) values.push(lineText);
    const rectText = textInRect(root, anchor.getBoundingClientRect(), e.clientX);
    if (rectText) values.push(rectText);
    for (const text of textsFromPoint(e.clientX, e.clientY, root)) values.push(text);
    const pointText = textAroundPoint(e.clientX, e.clientY);
    if (pointText) values.push(pointText);

    for (const node of [anchor, target]) {
      const labelled = [
        node.getAttribute('aria-label'),
        node.getAttribute('title'),
        node.getAttribute('data-citation'),
        node.textContent,
      ];
      for (const text of labelled) {
        const cleaned = cleanInlineText(text ?? '');
        if (cleaned && cleaned.length <= 260) values.push(cleaned);
      }
    }

    return [...new Set(values.map(cleanInlineText).filter(Boolean))];
  }

  private isPointerNearActiveCandidate(e: MouseEvent | PointerEvent): boolean {
    const anchor = this.activeCandidate?.anchor;
    if (!anchor) return false;
    const r = anchor.getBoundingClientRect();
    const margin = 18;
    return e.clientX >= r.left - margin &&
      e.clientX <= r.right + margin &&
      e.clientY >= r.top - margin &&
      e.clientY <= r.bottom + margin;
  }

  private ensurePopup(): HTMLElement {
    if (this.popupEl) return this.popupEl;
    this.popupEl = el('div', { className: 'nc-citation-hover' });
    setStyle(this.popupEl, { display: 'none' });
    activeDocument.body.appendChild(this.popupEl);
    this.popupEl.addEventListener('pointerover', (e) => e.stopPropagation());
    this.popupEl.addEventListener('pointerenter', () => this.clearHideTimer());
    this.popupEl.addEventListener('pointerleave', () => this.hideSoon(350));
    return this.popupEl;
  }

  private showLoading(candidate: HoverCandidate): void {
    const pop = this.ensurePopup();
    clear(pop);
    pop.createEl('div', { cls: 'nc-citation-title', text: 'Reference preview' });
    pop.createEl('div', { cls: 'nc-citation-cite', text: candidate.citation.raw });
    const row = pop.createEl('div', { cls: 'nc-citation-loading' });
    row.createEl('span', { cls: 'nc-citation-spinner' });
    row.appendText('Reading PDF references...');
    this.positionPopup(candidate.anchor);
  }

  private renderLookup(candidate: HoverCandidate, result: CitationLookup): void {
    const pop = this.ensurePopup();
    clear(pop);

    const head = pop.createEl('div', { cls: 'nc-citation-head' });
    head.createEl('div', { cls: 'nc-citation-title', text: 'Reference' });
    head.createEl('div', { cls: 'nc-citation-source', text: candidate.file.basename });
    pop.createEl('div', { cls: 'nc-citation-cite', text: normalizedCitationLabel(result.citation.raw) });

    if (result.status !== 'matched') {
      this.hide();
      return;
    }

    const visibleEntries = result.entries.slice(0, 1);
    for (const entry of visibleEntries) {
      this.renderEntry(pop, entry, false);
    }

    this.positionPopup(candidate.anchor);
  }

  private renderEntry(parent: HTMLElement, entry: PdfReferenceEntry, showLabel: boolean): void {
    const item = parent.createEl('div', { cls: 'nc-citation-entry' });
    const label = entry.number ? `[${entry.number}]` : 'Reference';
    if (showLabel) item.createEl('div', { cls: 'nc-citation-entry-label', text: label });
    item.createEl('div', { cls: 'nc-citation-entry-text', text: displayReferenceText(entry.text) });
    const meta: string[] = [];
    if (entry.page) meta.push(`p. ${entry.page}`);
    if (entry.doi) meta.push(`DOI ${entry.doi}`);
    if (entry.url) meta.push(entry.url);
    if (meta.length) item.createEl('div', { cls: 'nc-citation-meta', text: meta.join(' · ') });
  }

  private showMessage(candidate: HoverCandidate, title: string, message: string): void {
    const pop = this.ensurePopup();
    clear(pop);
    pop.createEl('div', { cls: 'nc-citation-title', text: title });
    pop.createEl('div', { cls: 'nc-citation-empty', text: message });
    this.positionPopup(candidate.anchor);
  }

  private positionPopup(anchor: HTMLElement): void {
    const pop = this.ensurePopup();
    setStyle(pop, { display: 'block' });
    window.requestAnimationFrame(() => {
      const r = anchor.getBoundingClientRect();
      const rect = pop.getBoundingClientRect();
      const margin = 10;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = r.left;
      if (left + rect.width + margin > vw) left = vw - rect.width - margin;
      left = Math.max(margin, left);

      let top = r.bottom + 8;
      if (top + rect.height + margin > vh) top = r.top - rect.height - 8;
      top = Math.max(margin, Math.min(vh - rect.height - margin, top));

      setStyle(pop, { left: `${left}px`, top: `${top}px` });
    });
  }

  private hide(): void {
    this.clearTimer();
    this.clearHideTimer();
    this.abortActive();
    this.seq++;
    this.activeCandidate = null;
    if (this.popupEl) setStyle(this.popupEl, { display: 'none' });
  }

  private clearTimer(): void {
    if (this.hoverTimer !== null) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private hideSoon(delay = 220): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.hide();
    }, delay);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private abortActive(): void {
    this.aborter?.abort();
    this.aborter = null;
  }
}

function closestHTMLElement(target: EventTarget | null): HTMLElement | null {
  if (!target) return null;
  if (isHTMLElement(target)) return target;
  const parent = (target as Node).parentElement;
  return isHTMLElement(parent) ? parent : null;
}

function cleanInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function textAroundPoint(x: number, y: number): string {
  const doc: any = activeDocument;
  let node: Node | null = null;
  let offset = 0;
  const range = typeof doc.caretRangeFromPoint === 'function' ? doc.caretRangeFromPoint(x, y) : null;
  if (range) {
    node = range.startContainer;
    offset = range.startOffset;
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    node = pos?.offsetNode ?? null;
    offset = pos?.offset ?? 0;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return '';
  const text = node.textContent ?? '';
  const start = Math.max(0, offset - 120);
  const end = Math.min(text.length, offset + 140);
  return cleanInlineText(text.slice(start, end));
}

function textInRect(root: HTMLElement, rect: DOMRect, pointX?: number): string {
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return '';
  if (rect.width <= 0 || rect.height <= 0) return '';
  const expanded = {
    left: rect.left - 2,
    right: rect.right + 2,
    top: rect.top - 2,
    bottom: rect.bottom + 2,
  };
  const spans = Array.from(root.querySelectorAll<HTMLElement>('.textLayer span, .textLayer div'));
  const hits = spans
    .map(span => ({ span, rect: span.getBoundingClientRect() }))
    .filter(hit => rectOverlapRatio(expanded, hit.rect) > 0.18)
    .sort((a, b) => Math.abs(a.rect.top - b.rect.top) > 2 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left)
    .slice(0, 8);
  const precise = hits
    .flatMap(hit => textFragmentsForRect(hit.span, hit.rect, rect, pointX))
    .filter(Boolean);
  if (precise.length) return precise[0];
  const text = hits.map(hit => cleanInlineText(hit.span.textContent ?? '')).join(' ');
  return text.length <= 320 ? text : '';
}

function citationTokenNearPoint(root: HTMLElement, anchorRect: DOMRect, pointX: number): string {
  const line = textLineNearRect(root, anchorRect, pointX);
  if (!line) return '';
  const tokens = citationTokens(line.text);
  if (!tokens.length) return '';
  const nearest = tokens
    .map(tok => ({ ...tok, dist: Math.abs((tok.start + tok.end) / 2 - line.index) }))
    .sort((a, b) => a.dist - b.dist)[0];
  return nearest?.text ?? '';
}

function textLineNearRect(root: HTMLElement, anchorRect: DOMRect, pointX: number): { text: string; index: number } | null {
  if (!Number.isFinite(anchorRect.width) || !Number.isFinite(anchorRect.height)) return null;
  const centerY = (anchorRect.top + anchorRect.bottom) / 2;
  const spans = Array.from(root.querySelectorAll<HTMLElement>('.textLayer span, .textLayer div'))
    .map(span => ({ span, rect: span.getBoundingClientRect(), text: cleanInlineText(span.textContent ?? '') }))
    .filter(hit => hit.text && Math.abs(((hit.rect.top + hit.rect.bottom) / 2) - centerY) <= Math.max(7, anchorRect.height * 0.75))
    .sort((a, b) => a.rect.left - b.rect.left);
  if (!spans.length) return null;

  let nearestIndex = 0;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < spans.length; i++) {
    const r = spans[i].rect;
    const dist = pointX >= r.left && pointX <= r.right
      ? 0
      : Math.min(Math.abs(pointX - r.left), Math.abs(pointX - r.right));
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIndex = i;
    }
  }

  const start = Math.max(0, nearestIndex - 4);
  const end = Math.min(spans.length, nearestIndex + 5);
  let text = '';
  let index = 0;
  for (let i = start; i < end; i++) {
    const prefix = text ? ' ' : '';
    if (i === nearestIndex) {
      const r = spans[i].rect;
      const ratio = r.width > 0 ? Math.max(0, Math.min(1, (pointX - r.left) / r.width)) : 0;
      index = text.length + prefix.length + Math.round(ratio * spans[i].text.length);
    }
    text += prefix + spans[i].text;
  }
  return text ? { text, index } : null;
}

function textFragmentsForRect(span: HTMLElement, spanRect: DOMRect, target: DOMRect, pointX?: number): string[] {
  const text = cleanInlineText(span.textContent ?? '');
  if (!text) return [];
  if (text.length <= 3) return [text];

  const targetCenter = Number.isFinite(pointX) && pointX != null && pointX >= spanRect.left && pointX <= spanRect.right
    ? pointX
    : Math.max(spanRect.left, Math.min(spanRect.right, (target.left + target.right) / 2));
  const ratio = spanRect.width > 0 ? (targetCenter - spanRect.left) / spanRect.width : 0;
  const approxIndex = Math.max(0, Math.min(text.length - 1, Math.round(ratio * text.length)));
  const tokens = citationTokens(text);
  if (tokens.length) {
    const nearest = tokens
      .map(tok => ({ ...tok, dist: Math.abs((tok.start + tok.end) / 2 - approxIndex) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (nearest) return [nearest.text];
  }

  const lo = Math.max(0, Math.floor(((target.left - spanRect.left) / Math.max(1, spanRect.width)) * text.length) - 2);
  const hi = Math.min(text.length, Math.ceil(((target.right - spanRect.left) / Math.max(1, spanRect.width)) * text.length) + 2);
  const fragment = cleanInlineText(text.slice(lo, hi));
  return fragment ? [fragment] : [];
}

function citationTokens(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const patterns = [
    /\[\s*\d{1,4}(?:\s*(?:,|;|-|–|—)\s*\d{1,4}){0,30}\s*\]/g,
    /\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’`-]+(?:\s+et\s+al\.)?\s*,?\s*(?:19|20)\d{2}[a-z]?\b/g,
    /\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’`-]+(?:\s+et\s+al\.)?\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g,
    /\b(?!19\d{2}\b|20\d{2}\b)\d{1,3}\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index == null) continue;
      out.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    }
  }
  return out;
}

function rectOverlapRatio(a: { left: number; right: number; top: number; bottom: number }, b: DOMRect): number {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  const bArea = Math.max(1, b.width * b.height);
  return area / bArea;
}

function textsFromPoint(x: number, y: number, root: HTMLElement): string[] {
  const out: string[] = [];
  const hidden: { el: HTMLElement; pointerEvents: string }[] = [];
  try {
    for (const hit of activeDocument.elementsFromPoint(x, y)) {
      if (!isHTMLElement(hit)) continue;
      if (!root.contains(hit)) continue;
      const text = cleanInlineText(hit.textContent ?? '');
      if (text && text.length <= 260) out.push(text);
      if (out.length >= 5) break;
    }

    // PDF.js annotation layers often sit above textLayer spans and contain no
    // useful text. Temporarily pointer-pass through a few top elements so
    // elementFromPoint can discover the text span below, then restore styles.
    for (let i = 0; i < 8 && out.length < 8; i++) {
      const hit = activeDocument.elementFromPoint(x, y);
      if (!isHTMLElement(hit) || !root.contains(hit)) break;
      const text = cleanInlineText(hit.textContent ?? '');
      if (text && text.length <= 260) out.push(text);
      if (hit === root || hidden.some(h => h.el === hit)) break;
      hidden.push({ el: hit, pointerEvents: hit.style.pointerEvents });
      setStyle(hit, { pointerEvents: 'none' });
    }
  } finally {
    for (let i = hidden.length - 1; i >= 0; i--) {
      setStyle(hidden[i].el, { pointerEvents: hidden[i].pointerEvents });
    }
  }
  return [...new Set(out)];
}

function normalizedCitationLabel(raw: string): string {
  const trimmed = cleanInlineText(raw);
  if (/^\d{1,4}$/.test(trimmed)) return `[${trimmed}]`;
  return trimmed;
}

function displayReferenceText(text: string): string {
  const cleaned = cleanInlineText(text);
  if (cleaned.length <= 440) return cleaned;
  return cleaned.slice(0, 420).trimEnd() + '...';
}

function isHTMLElement(value: unknown): value is HTMLElement {
  const el = value as Partial<HTMLElement> | null;
  return !!el && typeof el.closest === 'function' && typeof el.getBoundingClientRect === 'function';
}
