import { loadPdfJs } from 'obsidian';

export interface PdfExtractionOptions {
  pages?: string;
  maxPages?: number;
  maxChars?: number;
  task?: PdfReadTask;
  query?: string;
  signal?: AbortSignal;
}

export type PdfReadTask = 'auto' | 'inspect' | 'rename' | 'summarize' | 'search' | 'pages' | 'full';
export type PdfDocumentKind = 'text' | 'scanned' | 'mixed' | 'low-text' | 'complex-layout';
export type PdfTextLayerStatus = 'present' | 'partial' | 'absent';

export interface PdfPageSelection {
  pages: number[];
  label: string;
  truncatedByMaxPages: boolean;
}

export interface PdfPageTextStats {
  page: number;
  chars: number;
  lines: number;
  words: number;
  hasText: boolean;
  topLines: string[];
  sample: string;
}

export interface PdfSearchHit {
  page: number;
  count: number;
  snippets: string[];
}

export interface PdfDiagnostic {
  documentKind: PdfDocumentKind;
  textLayer: PdfTextLayerStatus;
  pagesSampled: number;
  pagesWithText: number;
  pagesWithoutText: number;
  averageCharsPerPage: number;
  averageLinesPerPage: number;
  metadataTitle?: string;
  titleCandidates: string[];
  recommendations: string[];
}

export interface PdfExtractionResult {
  task: PdfReadTask;
  text: string;
  pageCount: number;
  pagesRead: number[];
  pageLabel: string;
  chars: number;
  truncatedByChars: boolean;
  truncatedByMaxPages: boolean;
  pageStats: PdfPageTextStats[];
  diagnostic: PdfDiagnostic;
  searchHits: PdfSearchHit[];
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
    const task = normalizePdfReadTask(opts.task);
    const selection = selectPdfPagesForTask(opts.pages, pageCount, maxPages, task);
    const metadataTitle = await readPdfMetadataTitle(doc);

    const chunks: string[] = [];
    const pageTexts: { page: number; text: string }[] = [];
    let truncatedByChars = false;
    let foundExtractableText = false;
    for (const pageNo of selection.pages) {
      throwIfAborted(opts.signal);
      const page = await doc.getPage(pageNo);
      try {
        const content = await page.getTextContent();
        const pageText = textItemsToString(content?.items ?? []);
        pageTexts.push({ page: pageNo, text: pageText });
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
    const pageStats = pageTexts.map(({ page, text }) => analyzePdfPageText(page, text));
    const diagnostic = diagnosePdf(pageStats, metadataTitle, task);
    const searchHits = collectPdfSearchHits(pageTexts, opts.query);
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
      task,
      text,
      pageCount,
      pagesRead: selection.pages,
      pageLabel: selection.label,
      chars: text.length,
      truncatedByChars,
      truncatedByMaxPages: selection.truncatedByMaxPages,
      pageStats,
      diagnostic,
      searchHits,
      warnings,
    };
  } finally {
    try { await doc?.destroy?.(); } catch { /* best effort */ }
    try { await loadingTask?.destroy?.(); } catch { /* best effort */ }
  }
}

export function selectPdfPagesForTask(input: unknown, pageCount: number, maxPages = DEFAULT_MAX_PAGES, task: PdfReadTask = 'auto'): PdfPageSelection {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw) return parsePdfPageSelection(raw, pageCount, maxPages);

  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (total <= 0) throw new Error('PDF has no pages.');
  const cap = clampInt(maxPages, 1, total);

  switch (normalizePdfReadTask(task)) {
    case 'inspect':
    case 'rename':
      return selectionFromPages([1], total, cap);
    case 'summarize': {
      const front = range(1, Math.min(total, 8));
      const tailStart = Math.max(1, total - 1);
      return selectionFromPages([...front, ...range(tailStart, total)], total, cap);
    }
    case 'pages':
    case 'search':
    case 'full':
    case 'auto':
    default:
      return parsePdfPageSelection('', total, cap);
  }
}

export function formatPdfDiagnosticMarkdown(result: PdfExtractionResult): string {
  const d = result.diagnostic;
  const lines = [
    '### PDF inspection',
    `- Task: ${result.task}`,
    `- Type: ${d.documentKind} (text layer: ${d.textLayer})`,
    `- Pages sampled: ${d.pagesSampled}; with text: ${d.pagesWithText}; without text: ${d.pagesWithoutText}`,
    `- Average extracted text: ${d.averageCharsPerPage} chars/page, ${d.averageLinesPerPage} lines/page`,
  ];
  if (d.metadataTitle) lines.push(`- Metadata title: ${d.metadataTitle}`);
  if (d.titleCandidates.length) {
    lines.push('- Title candidates:');
    for (const title of d.titleCandidates.slice(0, 5)) lines.push(`  - ${title}`);
  }
  if (d.recommendations.length) {
    lines.push('- Recommended next steps:');
    for (const rec of d.recommendations) lines.push(`  - ${rec}`);
  }
  if (result.searchHits.length) {
    lines.push('- Search hits:');
    for (const hit of result.searchHits.slice(0, 10)) {
      lines.push(`  - Page ${hit.page}: ${hit.count} hit(s)`);
    }
  }
  return lines.join('\n');
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

function normalizePdfReadTask(task: unknown): PdfReadTask {
  const raw = typeof task === 'string' ? task.trim().toLowerCase() : '';
  if (raw === 'summary') return 'summarize';
  if (raw === 'metadata' || raw === 'title') return 'inspect';
  if (raw === 'find' || raw === 'query') return 'search';
  if (raw === 'page') return 'pages';
  if (
    raw === 'inspect' ||
    raw === 'rename' ||
    raw === 'summarize' ||
    raw === 'search' ||
    raw === 'pages' ||
    raw === 'full'
  ) return raw;
  return 'auto';
}

function selectionFromPages(pages: number[], pageCount: number, maxPages: number): PdfPageSelection {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (total <= 0) throw new Error('PDF has no pages.');
  const cap = clampInt(maxPages, 1, total);
  const selected = [...new Set(pages.filter(p => p >= 1 && p <= total))].sort((a, b) => a - b);
  const truncated = selected.length > cap;
  const finalPages = truncated ? selected.slice(0, cap) : selected;
  return {
    pages: finalPages,
    label: summarizePages(finalPages),
    truncatedByMaxPages: truncated,
  };
}

async function readPdfMetadataTitle(doc: any): Promise<string | undefined> {
  try {
    const metadata = await doc?.getMetadata?.();
    const info = metadata?.info ?? {};
    return cleanPdfTitle(info.Title ?? info.title);
  } catch {
    return undefined;
  }
}

function analyzePdfPageText(page: number, text: string): PdfPageTextStats {
  const normalized = text.trim();
  const lines = normalized ? normalized.split(/\n+/).map(s => s.trim()).filter(Boolean) : [];
  const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  return {
    page,
    chars: normalized.length,
    lines: lines.length,
    words,
    hasText: normalized.length >= 40,
    topLines: lines.slice(0, 12),
    sample: normalized.replace(/\s+/g, ' ').slice(0, 220),
  };
}

function diagnosePdf(pageStats: PdfPageTextStats[], metadataTitle: string | undefined, task: PdfReadTask): PdfDiagnostic {
  const pagesSampled = pageStats.length;
  const pagesWithText = pageStats.filter(p => p.hasText).length;
  const pagesWithoutText = Math.max(0, pagesSampled - pagesWithText);
  const totalChars = pageStats.reduce((sum, p) => sum + p.chars, 0);
  const totalLines = pageStats.reduce((sum, p) => sum + p.lines, 0);
  const averageCharsPerPage = pagesSampled ? Math.round(totalChars / pagesSampled) : 0;
  const averageLinesPerPage = pagesSampled ? Math.round(totalLines / pagesSampled) : 0;
  const textLayer: PdfTextLayerStatus =
    pagesWithText === 0 ? 'absent' :
    pagesWithoutText > 0 ? 'partial' :
    'present';

  let documentKind: PdfDocumentKind = 'text';
  if (textLayer === 'absent') documentKind = 'scanned';
  else if (textLayer === 'partial') documentKind = 'mixed';
  else if (averageCharsPerPage < 250) documentKind = 'low-text';
  else if (looksComplexLayout(pageStats)) documentKind = 'complex-layout';

  const recommendations: string[] = [];
  if (documentKind === 'scanned') {
    recommendations.push('No useful text layer was found; render pages and run OCR before relying on the content.');
  } else if (documentKind === 'mixed' || documentKind === 'low-text') {
    recommendations.push('Text extraction is sparse or partial; cross-check with rendered pages before renaming, citing, or summarizing.');
  } else if (documentKind === 'complex-layout') {
    recommendations.push('The text layer may not preserve reading order; use extracted text for search, then visually inspect pages with tables, figures, or formulas.');
  }
  if (task === 'rename' || task === 'inspect') {
    recommendations.push('For title or rename tasks, compare metadata with the first-page title candidate; PDF metadata is often stale.');
  }
  if (task === 'summarize') {
    recommendations.push('For a full paper summary, follow up with targeted reads of abstract, introduction, method, experiments, and conclusion pages.');
  }
  if (task === 'search') {
    recommendations.push('Use the reported hit pages for focused follow-up reads instead of reading the whole PDF.');
  }

  return {
    documentKind,
    textLayer,
    pagesSampled,
    pagesWithText,
    pagesWithoutText,
    averageCharsPerPage,
    averageLinesPerPage,
    metadataTitle,
    titleCandidates: collectTitleCandidates(pageStats, metadataTitle),
    recommendations,
  };
}

function looksComplexLayout(pageStats: PdfPageTextStats[]): boolean {
  const textPages = pageStats.filter(p => p.hasText);
  if (!textPages.length) return false;
  const shortLinePages = textPages.filter(p => p.lines >= 35 && p.chars / Math.max(1, p.lines) < 42).length;
  const denseLinePages = textPages.filter(p => p.lines >= 80).length;
  const formulaLikePages = textPages.filter(p => /[∑∫√≈≤≥]|\\[a-z]+|[A-Za-z]\s*=\s*[^=\n]+/.test(p.sample)).length;
  return shortLinePages + denseLinePages + formulaLikePages >= Math.max(1, Math.ceil(textPages.length * 0.35));
}

function collectTitleCandidates(pageStats: PdfPageTextStats[], metadataTitle: string | undefined): string[] {
  const out: string[] = [];
  if (metadataTitle) out.push(metadataTitle);

  const firstPage = pageStats.find(p => p.page === 1) ?? pageStats[0];
  const lines = firstPage?.topLines?.length
    ? firstPage.topLines.map(cleanPdfTitle).filter(Boolean)
    : firstPage?.sample
      ? firstPage.sample.split(/[.!?]\s+|\s{2,}/).map(cleanPdfTitle).filter(Boolean)
      : [];
  for (const line of lines) {
    if (out.length >= 6) break;
    if (line.length < 8 || line.length > 180) continue;
    if (/^(abstract|introduction|contents|references|arxiv|doi\b)/i.test(line)) continue;
    if (!out.some(x => x.toLowerCase() === line.toLowerCase())) out.push(line);
  }
  return out;
}

function collectPdfSearchHits(pageTexts: { page: number; text: string }[], query: unknown): PdfSearchHit[] {
  const needle = typeof query === 'string' ? query.trim() : '';
  if (!needle) return [];
  const loweredNeedle = needle.toLowerCase();
  const terms = [...new Set(loweredNeedle.split(/\s+/).filter(t => t.length >= 2))];
  const hits: PdfSearchHit[] = [];
  for (const { page, text } of pageTexts) {
    const normalized = text.replace(/\s+/g, ' ');
    const lower = normalized.toLowerCase();
    const snippets: string[] = [];
    let count = 0;

    const exactIndexes = allIndexesOf(lower, loweredNeedle);
    if (exactIndexes.length) {
      count = exactIndexes.length;
      for (const idx of exactIndexes.slice(0, 4)) snippets.push(makeSnippet(normalized, idx, needle.length));
    } else if (terms.length > 1 && terms.every(t => lower.includes(t))) {
      count = terms.reduce((sum, t) => sum + allIndexesOf(lower, t).length, 0);
      const first = Math.min(...terms.map(t => lower.indexOf(t)).filter(i => i >= 0));
      snippets.push(makeSnippet(normalized, first, terms[0].length));
    }

    if (count > 0) hits.push({ page, count, snippets });
  }
  return hits;
}

function allIndexesOf(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    out.push(idx);
    idx = haystack.indexOf(needle, idx + Math.max(1, needle.length));
  }
  return out;
}

function makeSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 140);
  const end = Math.min(text.length, index + length + 180);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function cleanPdfTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const title = value
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || /^untitled$/i.test(title)) return '';
  return title;
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
