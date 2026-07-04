/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { App, TFile, loadPdfJs } from 'obsidian';
import { textItemsToString } from '../utils/pdf';

export interface PdfReferenceEntry {
  number?: number;
  text: string;
  page?: number;
  doi?: string;
  url?: string;
}

export interface PdfReferenceIndex {
  fileKey: string;
  pageCount: number;
  pagesRead: number[];
  hasReferenceHeading: boolean;
  entries: PdfReferenceEntry[];
  entriesByNumber: Map<number, PdfReferenceEntry>;
  rawReferenceText: string;
}

export interface ParsedCitation {
  raw: string;
  numbers: number[];
  surnames: string[];
  years: string[];
}

export interface CitationLookup {
  citation: ParsedCitation;
  entries: PdfReferenceEntry[];
  status: 'matched' | 'not-found' | 'no-references';
  message?: string;
}

interface CachedIndex {
  mtime: number;
  size: number;
  promise: Promise<PdfReferenceIndex>;
  touched: number;
}

const MAX_TAIL_PAGES = 24;
const MAX_CACHE_ITEMS = 20;
const MAX_REFERENCE_TEXT_CHARS = 180_000;
const MAX_SAFE_AUTHOR_YEAR_ENTRY_CHARS = 900;
const MAX_SAFE_NUMBERED_ENTRY_CHARS = 1_200;
const AUTHOR_SURNAME_MATCH_WINDOW = 140;

export class PdfReferenceIndexCache {
  private cache = new Map<string, CachedIndex>();

  async get(app: App, file: TFile, signal?: AbortSignal): Promise<PdfReferenceIndex> {
    const cached = this.cache.get(file.path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      cached.touched = Date.now();
      return cached.promise;
    }

    const promise = buildPdfReferenceIndex(app, file, signal);
    promise.catch(() => {
      const cur = this.cache.get(file.path);
      if (cur?.promise === promise) this.cache.delete(file.path);
    });
    this.cache.set(file.path, {
      mtime: file.stat.mtime,
      size: file.stat.size,
      promise,
      touched: Date.now(),
    });
    this.evict();
    return promise;
  }

  clear(): void {
    this.cache.clear();
  }

  private evict(): void {
    if (this.cache.size <= MAX_CACHE_ITEMS) return;
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].touched - b[1].touched)[0]?.[0];
    if (oldest) this.cache.delete(oldest);
  }
}

export function parseCitationText(input: string): ParsedCitation | null {
  const raw = normalizeCitationText(input);
  if (!raw) return null;
  const focused = extractLikelyCitation(raw);
  if (!focused) return null;

  const numbers = extractCitationNumbers(focused);
  const years = [...new Set([...focused.matchAll(/\b(?:19|20)\d{2}[a-z]?\b/g)].map(m => m[0]))];
  const surnames = extractCitationSurnames(focused);

  if (numbers.length === 0 && (years.length === 0 || surnames.length === 0)) return null;
  return {
    raw: focused,
    numbers,
    surnames,
    years,
  };
}

export function lookupCitation(index: PdfReferenceIndex, citation: ParsedCitation): CitationLookup {
  if (!index.entries.length && index.entriesByNumber.size === 0) {
    return { citation, entries: [], status: 'no-references', message: 'No extractable reference section was found.' };
  }

  const entries: PdfReferenceEntry[] = [];
  for (const n of citation.numbers.slice(0, 8)) {
    const entry = index.entriesByNumber.get(n);
    if (entry) entries.push(entry);
  }
  if (entries.length) return { citation, entries, status: 'matched' };

  const authorEntries = lookupAuthorYearEntries(index.entries, citation);
  if (authorEntries.length) {
    return {
      citation,
      entries: authorEntries,
      status: 'matched',
    };
  }

  return {
    citation,
    entries: [],
    status: 'not-found',
    message: 'No matching reference was found in the extracted reference section.',
  };
}

async function buildPdfReferenceIndex(app: App, file: TFile, signal?: AbortSignal): Promise<PdfReferenceIndex> {
  throwIfAborted(signal);
  const data = await app.vault.readBinary(file);
  throwIfAborted(signal);
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data).slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  let doc: any | null = null;
  try {
    doc = await loadingTask.promise;
    throwIfAborted(signal);
    const pageCount = Math.max(0, Number(doc?.numPages) || 0);
    const start = Math.max(1, pageCount - MAX_TAIL_PAGES + 1);
    const pages = range(start, pageCount);
    const pageTexts: { page: number; text: string }[] = [];
    for (const pageNo of pages) {
      throwIfAborted(signal);
      const page = await doc.getPage(pageNo);
      try {
        const viewport = page.getViewport?.({ scale: 1 });
        const content = await page.getTextContent();
        const lines = textItemsToReferenceLines(content?.items ?? [], Number(viewport?.width) || 0);
        const text = lines.join('\n') || textItemsToString(content?.items ?? []);
        pageTexts.push({ page: pageNo, text });
      } finally {
        try { page?.cleanup?.(); } catch { /* best effort */ }
      }
    }

    const refLines = referenceLines(pageTexts);
    const rawReferenceText = refLines.map(l => l.text).join('\n').slice(0, MAX_REFERENCE_TEXT_CHARS);
    const entries = parseReferenceEntries(refLines);
    const entriesByNumber = new Map<number, PdfReferenceEntry>();
    for (const entry of entries) {
      if (typeof entry.number === 'number') entriesByNumber.set(entry.number, entry);
    }

    return {
      fileKey: `${file.path}:${file.stat.mtime}:${file.stat.size}`,
      pageCount,
      pagesRead: pages,
      hasReferenceHeading: refLines.startFound,
      entries,
      entriesByNumber,
      rawReferenceText,
    };
  } finally {
    try { await doc?.destroy?.(); } catch { /* best effort */ }
    try { await loadingTask?.destroy?.(); } catch { /* best effort */ }
  }
}

type RefLine = { page: number; text: string };
type RefLines = RefLine[] & { startFound: boolean };

function referenceLines(pageTexts: { page: number; text: string }[]): RefLines {
  const lines: RefLine[] = [];
  for (const block of pageTexts) {
    for (const line of block.text.split('\n')) {
      const text = cleanReferenceLine(line);
      if (text) lines.push({ page: block.page, text });
    }
  }

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isReferenceHeading(lines[i].text)) start = i;
  }
  const selected = (start >= 0 ? lines.slice(start + 1) : lines) as RefLines;
  selected.startFound = start >= 0;
  return selected;
}

function parseReferenceEntries(lines: RefLine[]): PdfReferenceEntry[] {
  const numbered = parseNumberedReferences(lines);
  return numbered.length ? numbered : parseAuthorYearReferences(lines);
}

function parseNumberedReferences(lines: RefLine[]): PdfReferenceEntry[] {
  const entries: PdfReferenceEntry[] = [];
  let current: PdfReferenceEntry | null = null;
  let numberedStarts = 0;

  for (const line of lines) {
    const start = line.text.match(/^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+(.{6,})$/);
    if (start) numberedStarts++;
  }
  if (numberedStarts < 2) return entries;

  const flush = () => {
    if (!current) return;
    current.text = cleanReferenceText(current.text);
    if (current.text.length >= 20 && current.text.length <= MAX_SAFE_NUMBERED_ENTRY_CHARS) {
      current.doi = extractDoi(current.text);
      current.url = extractUrl(current.text);
      entries.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const start = line.text.match(/^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+(.+)$/);
    if (start) {
      flush();
      current = {
        number: Number(start[1] ?? start[2]),
        text: start[3],
        page: line.page,
      };
    } else if (current) {
      current.text += ' ' + line.text;
      if (current.text.length > MAX_SAFE_NUMBERED_ENTRY_CHARS * 1.5) {
        current = null;
      }
    }
  }
  flush();
  return entries;
}

function parseAuthorYearReferences(lines: RefLine[]): PdfReferenceEntry[] {
  const entries: PdfReferenceEntry[] = [];
  let current: PdfReferenceEntry | null = null;

  const flush = () => {
    if (!current) return;
    current.text = cleanReferenceText(current.text);
    if (isSafeAuthorYearReferenceEntry(current.text)) {
      current.doi = extractDoi(current.text);
      current.url = extractUrl(current.text);
      entries.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    if (isLikelyAuthorYearReferenceStart(line.text)) {
      flush();
      current = { text: line.text, page: line.page };
      continue;
    }
    if (current) {
      current.text += ' ' + line.text;
      if (current.text.length > MAX_SAFE_AUTHOR_YEAR_ENTRY_CHARS * 1.5) {
        current = null;
      }
    }
  }
  flush();

  return entries.length >= 2 ? entries : [];
}

function lookupAuthorYearEntries(entries: PdfReferenceEntry[], citation: ParsedCitation): PdfReferenceEntry[] {
  if (!citation.years.length || !citation.surnames.length) return [];
  const out: { entry: PdfReferenceEntry; score: number }[] = [];
  const seen = new Set<PdfReferenceEntry>();
  for (const year of citation.years) {
    const yearPasses = year.length > 4
      ? [[year.toLowerCase()], [year.slice(0, 4).toLowerCase()]]
      : [[year.toLowerCase()]];
    for (const yearNeedles of yearPasses) {
      let matchedThisPass = false;
      for (const surname of citation.surnames) {
        const needle = surname.toLowerCase();
        for (const entry of entries) {
          const text = cleanReferenceText(entry.text);
          if (!isSafeAuthorYearReferenceEntry(text)) continue;
          const lower = text.toLowerCase();
          const surnamePos = lower.indexOf(needle);
          if (surnamePos < 0 || surnamePos > AUTHOR_SURNAME_MATCH_WINDOW) continue;
          const yearPos = yearNeedles
            .map(y => lower.indexOf(y))
            .filter(pos => pos >= 0)
            .sort((a, b) => a - b)[0] ?? -1;
          if (yearPos < 0) continue;
          if (yearPos > 650) continue;
          if (!seen.has(entry)) {
            seen.add(entry);
            out.push({
              entry,
              score: surnamePos + (yearPos > 260 ? 80 : 0) + (yearNeedles[0] === year.toLowerCase() ? 0 : 40),
            });
          }
          matchedThisPass = true;
          break;
        }
      }
      if (matchedThisPass) break;
    }
  }
  return out.sort((a, b) => a.score - b.score).map(item => item.entry).slice(0, 2);
}

function extractLikelyCitation(text: string): string | null {
  const bracket = text.match(/\[\s*\d{1,4}(?:\s*(?:,|;|-|–|—)\s*\d{1,4}){0,30}\s*\]/);
  if (bracket) return bracket[0];

  const parenthetical = text.match(/\((?=[^)]+(?:19|20)\d{2})[^)]{3,180}\)/);
  if (parenthetical) return parenthetical[0];

  const authorYear = text.match(/\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’`-]+(?:\s+et\s+al\.)?\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/);
  if (authorYear) return authorYear[0];

  if (isPlausibleBareNumberCitation(text)) return text;
  return null;
}

function extractCitationNumbers(citation: string): number[] {
  const body = citation.replace(/^\[/, '').replace(/\]$/, '');
  const out: number[] = [];
  for (const part of body.split(/[;,]/)) {
    const token = part.trim();
    const range = token.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,4})$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let n = lo; n <= hi && out.length < 12; n++) out.push(n);
      continue;
    }
    if (/^\d{1,4}$/.test(token)) out.push(Number(token));
  }
  return [...new Set(out.filter(n => n > 0))];
}

function isPlausibleBareNumberCitation(text: string): boolean {
  const s = text.trim();
  if (!/^\d{1,4}(?:\s*(?:,|;|-|–|—)\s*\d{1,4}){0,20}$/.test(s)) return false;
  const nums = [...s.matchAll(/\d{1,4}/g)].map(m => Number(m[0]));
  return nums.length > 0 && nums.every(n => n > 0 && n <= 999);
}

function extractCitationSurnames(citation: string): string[] {
  const noBrackets = citation
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .replace(/\bet\s+al\./gi, '')
    .replace(/\b(?:and|&)\b/g, ';');
  const candidates = [...noBrackets.matchAll(/\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’`-]{2,}\b/g)]
    .map(m => m[0])
    .filter(s => !STOP_WORDS.has(s.toLowerCase()) && !/^(19|20)\d{2}/.test(s));
  return [...new Set(candidates)].slice(0, 6);
}

function normalizeCitationText(input: string): string {
  return input
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

function cleanReferenceLine(line: string): string {
  return line
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanReferenceText(text: string): string {
  return text
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .trim();
}

function isReferenceHeading(text: string): boolean {
  return /^(references|bibliography|works cited|literature cited|参考文献|参考资料)$/i.test(text.trim());
}

function isLikelyAuthorYearReferenceStart(text: string): boolean {
  const s = text.trim();
  if (s.length < 20) return false;
  if (/^(url|doi)\b/i.test(s)) return false;
  if (/^\s*(?:\[\d{1,4}\]|\d{1,4}[.)])\s+/.test(s)) return false;
  if (!/^[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’`-]{1,30}(?:,|\s+[A-Z][a-zÀ-ÖØ-öø-ÿ'’`-]+,)/.test(s)) return false;
  if (/\b(?:19|20)\d{2}[a-z]?\b/.test(s.slice(0, 260))) return true;
  if (/\b(?:arXiv|Proceedings|Conference|Journal|Transactions|In\s+Findings|In\s+Proceedings)\b/i.test(s)) return true;
  return /,\s+[A-Z]\./.test(s.slice(0, 120));
}

function isSafeAuthorYearReferenceEntry(text: string): boolean {
  const s = cleanReferenceText(text);
  if (s.length < 35 || s.length > MAX_SAFE_AUTHOR_YEAR_ENTRY_CHARS) return false;
  if (!/\b(?:19|20)\d{2}[a-z]?\b/.test(s)) return false;
  if (/^(url|doi|abstract|introduction|conclusion|figure|table|section|appendix)\b/i.test(s)) return false;
  if (!/^[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’`-]{1,40}(?:,|\s+[A-Z][a-zÀ-ÖØ-öø-ÿ'’`-]+,)/.test(s)) return false;
  const firstYear = s.search(/\b(?:19|20)\d{2}[a-z]?\b/);
  if (firstYear > 700) return false;
  const sentenceBreaks = (s.slice(0, Math.min(firstYear, 260)).match(/[.!?]\s+[A-Z]/g) ?? []).length;
  return sentenceBreaks <= 2;
}

interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextLine {
  text: string;
  x: number;
  y: number;
}

function textItemsToReferenceLines(items: any[], pageWidth: number): string[] {
  const runs: TextRun[] = [];
  for (const item of items ?? []) {
    const text = typeof item?.str === 'string' ? item.str.replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    const x = typeof transform[4] === 'number' ? transform[4] : 0;
    const y = typeof transform[5] === 'number' ? transform[5] : 0;
    runs.push({
      text,
      x,
      y,
      width: typeof item?.width === 'number' ? item.width : text.length * 5,
      height: typeof item?.height === 'number' ? item.height : 10,
    });
  }
  if (!runs.length) return [];

  const width = pageWidth || Math.max(...runs.map(r => r.x + r.width), 1);
  const leftRuns = runs.filter(r => r.x + r.width / 2 < width * 0.52);
  const rightRuns = runs.filter(r => r.x + r.width / 2 >= width * 0.52);
  const twoColumn = leftRuns.length >= 30 && rightRuns.length >= 30;
  const ordered = twoColumn
    ? [...runsToLines(leftRuns), ...runsToLines(rightRuns)]
    : runsToLines(runs);

  return ordered.map(l => cleanReferenceLine(l.text)).filter(Boolean);
}

function runsToLines(runs: TextRun[]): TextLine[] {
  runs.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
  const rawLines: TextRun[][] = [];
  for (const run of runs) {
    const last = rawLines[rawLines.length - 1];
    const tolerance = Math.max(2, run.height * 0.45);
    if (!last || Math.abs(last[0].y - run.y) > tolerance) rawLines.push([run]);
    else last.push(run);
  }

  return rawLines.map(line => {
    const sorted = line.slice().sort((a, b) => a.x - b.x);
    return {
      text: runsToLineText(sorted),
      x: Math.min(...sorted.map(r => r.x)),
      y: sorted.reduce((sum, r) => sum + r.y, 0) / sorted.length,
    };
  }).sort(sortLineTopDown);
}

function runsToLineText(runs: TextRun[]): string {
  const sorted = runs.slice().sort((a, b) => a.x - b.x);
  let out = '';
  let last: TextRun | null = null;
  for (const run of sorted) {
    if (last && shouldJoinWithSpace(last, run)) out += ' ';
    out += run.text;
    last = run;
  }
  return out.trim();
}

function shouldJoinWithSpace(prev: TextRun, next: TextRun): boolean {
  const a = prev.text[prev.text.length - 1] ?? '';
  const b = next.text[0] ?? '';
  if (!a || !b) return false;
  if (/\s/.test(a) || /\s/.test(b)) return false;
  if (a === '(' || a === '[' || a === '{' || a === '/' || /^[,.;:!?%)]/.test(b)) return false;
  const gap = next.x - (prev.x + prev.width);
  return gap > Math.max(1.5, prev.height * 0.18);
}

function sortLineTopDown(a: TextLine, b: TextLine): number {
  return Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x;
}

function extractDoi(text: string): string | undefined {
  return text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[).,;]+$/, '');
}

function extractUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s<>)]+/i)?.[0]?.replace(/[).,;]+$/, '');
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

const STOP_WORDS = new Set([
  'and',
  'the',
  'with',
  'from',
  'figure',
  'table',
  'section',
  'appendix',
  'references',
  'bibliography',
]);
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
