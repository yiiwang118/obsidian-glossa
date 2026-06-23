import { loadPdfJs } from 'obsidian';

export interface PdfExtractionOptions {
  pages?: string;
  maxPages?: number;
  maxChars?: number;
  signal?: AbortSignal;
}

export interface PdfPageSelection {
  pages: number[];
  label: string;
  truncatedByMaxPages: boolean;
}

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  pagesRead: number[];
  pageLabel: string;
  chars: number;
  truncatedByChars: boolean;
  truncatedByMaxPages: boolean;
  warnings: string[];
}

const DEFAULT_MAX_PAGES = 80;
const DEFAULT_MAX_CHARS = 100_000;
const HARD_MAX_CHARS = 1_000_000;

export function parsePdfPageSelection(input: unknown, pageCount: number, maxPages = DEFAULT_MAX_PAGES): PdfPageSelection {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (total <= 0) throw new Error('PDF has no pages.');

  const cap = clampInt(maxPages, 1, total);
  const raw = typeof input === 'string' ? input.trim() : '';
  let pages: number[] = [];

  if (!raw) {
    pages = range(1, Math.min(total, cap));
    return {
      pages,
      label: pages.length === total ? 'all' : `1-${pages.length}`,
      truncatedByMaxPages: total > cap,
    };
  }

  const seen = new Set<number>();
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const single = token.match(/^\d+$/);
    if (single) {
      const p = Number(token);
      if (p >= 1 && p <= total) seen.add(p);
      continue;
    }

    const span = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (span) {
      const start = Number(span[1]);
      const end = Number(span[2]);
      if (start < 1 || end < 1) continue;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let p = lo; p <= hi && p <= total; p++) seen.add(p);
      continue;
    }

    throw new Error(`Invalid page range "${token}". Use "1", "1-3", or "1-3,7".`);
  }

  pages = [...seen].sort((a, b) => a - b);
  if (pages.length === 0) {
    throw new Error(`No valid pages in "${raw}" for a ${total}-page PDF.`);
  }

  const truncated = pages.length > cap;
  if (truncated) pages = pages.slice(0, cap);
  return {
    pages,
    label: summarizePages(pages),
    truncatedByMaxPages: truncated,
  };
}

export async function extractPdfTextFromArrayBuffer(data: ArrayBuffer | Uint8Array, opts: PdfExtractionOptions = {}): Promise<PdfExtractionResult> {
  const pdfjs = await loadPdfJs();
  return extractPdfTextWithPdfJs(pdfjs, data, opts);
}

export async function extractPdfTextWithPdfJs(pdfjs: any, data: ArrayBuffer | Uint8Array, opts: PdfExtractionOptions = {}): Promise<PdfExtractionResult> {
  if (!pdfjs?.getDocument) throw new Error('PDF.js is not available.');
  throwIfAborted(opts.signal);

  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data).slice();
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  let doc: any | null = null;
  try {
    doc = await loadingTask.promise;
    throwIfAborted(opts.signal);

    const pageCount = Math.max(0, Number(doc?.numPages) || 0);
    const maxPages = clampInt(opts.maxPages ?? DEFAULT_MAX_PAGES, 1, Math.max(1, pageCount));
    const maxChars = clampInt(opts.maxChars ?? DEFAULT_MAX_CHARS, 1_000, HARD_MAX_CHARS);
    const selection = parsePdfPageSelection(opts.pages, pageCount, maxPages);

    const chunks: string[] = [];
    let truncatedByChars = false;
    let foundExtractableText = false;
    for (const pageNo of selection.pages) {
      throwIfAborted(opts.signal);
      const page = await doc.getPage(pageNo);
      try {
        const content = await page.getTextContent();
        const pageText = textItemsToString(content?.items ?? []);
        if (pageText.trim()) foundExtractableText = true;
        const block = `### Page ${pageNo}\n${pageText || '[No extractable text on this page]'}`;
        const next = chunks.length ? `${chunks.join('\n\n')}\n\n${block}` : block;
        if (next.length > maxChars) {
          const remaining = Math.max(0, maxChars - (chunks.length ? chunks.join('\n\n').length + 2 : 0));
          if (remaining > 0) chunks.push(block.slice(0, remaining));
          truncatedByChars = true;
          break;
        }
        chunks.push(block);
      } finally {
        try { page?.cleanup?.(); } catch { /* best effort */ }
      }
    }

    const text = chunks.join('\n\n').trim();
    const warnings: string[] = [];
    if (selection.truncatedByMaxPages) {
      warnings.push(`Only the first ${selection.pages.length} selected page(s) were read because of the max_pages cap.`);
    }
    if (truncatedByChars) {
      warnings.push(`Text was truncated at ${maxChars.toLocaleString()} characters.`);
    }
    if (!foundExtractableText) {
      warnings.push('No extractable text was found. This may be a scanned or image-only PDF.');
    }

    return {
      text,
      pageCount,
      pagesRead: selection.pages,
      pageLabel: selection.label,
      chars: text.length,
      truncatedByChars,
      truncatedByMaxPages: selection.truncatedByMaxPages,
      warnings,
    };
  } finally {
    try { await doc?.destroy?.(); } catch { /* best effort */ }
    try { await loadingTask?.destroy?.(); } catch { /* best effort */ }
  }
}

export function textItemsToString(items: any[]): string {
  const lines: string[] = [];
  let line = '';
  let lineY: number | null = null;
  let lastEndX: number | null = null;
  let lastStr = '';

  const flush = () => {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
    line = '';
    lineY = null;
    lastEndX = null;
    lastStr = '';
  };

  for (const item of items ?? []) {
    const raw = typeof item?.str === 'string' ? item.str : '';
    const str = raw.replace(/\s+/g, ' ');
    const transform = Array.isArray(item?.transform) ? item.transform : null;
    const x = typeof transform?.[4] === 'number' ? transform[4] : null;
    const y = typeof transform?.[5] === 'number' ? transform[5] : null;
    const width = typeof item?.width === 'number' ? item.width : 0;
    const height = typeof item?.height === 'number' ? item.height : 10;
    const yTolerance = Math.max(2, height * 0.35);

    if (line && y !== null && lineY !== null && Math.abs(y - lineY) > yTolerance) {
      flush();
    }
    if (lineY === null && y !== null) lineY = y;

    if (str) {
      const gap = x !== null && lastEndX !== null ? x - lastEndX : null;
      if (shouldInsertSpace(lastStr, str, gap, height)) line += ' ';
      line += str;
      lastStr = str;
      if (x !== null) lastEndX = x + width;
    }

    if (item?.hasEOL) flush();
  }
  flush();

  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shouldInsertSpace(prev: string, next: string, gap: number | null, height: number): boolean {
  if (!prev || !next) return false;
  const a = prev[prev.length - 1];
  const b = next[0];
  if (/\s/.test(a) || /\s/.test(b)) return false;
  if (isCjk(a) && isCjk(b)) return false;
  if (/^[,.;:!?%)]/.test(b)) return false;
  if (/[(\[{/]$/.test(a)) return false;
  if (gap === null) return false;
  return gap > Math.max(1.5, height * 0.18);
}

function isCjk(ch: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function summarizePages(pages: number[]): string {
  if (pages.length === 0) return '';
  const spans: string[] = [];
  let start = pages[0];
  let prev = pages[0];
  for (let i = 1; i < pages.length; i++) {
    const p = pages[i];
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    spans.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = p;
  }
  spans.push(start === prev ? String(start) : `${start}-${prev}`);
  const label = spans.join(',');
  return label.length > 80 ? `${label.slice(0, 77)}...` : label;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value) || min);
  return Math.max(min, Math.min(max, n));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('PDF extraction aborted.');
}
