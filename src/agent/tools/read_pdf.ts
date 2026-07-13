/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { setStyle } from '../../utils/dom';
import { formatPdfDiagnosticMarkdown, type PdfExtractionResult, type PdfReadTask } from '../../utils/pdf';
import { extractVaultPdfCached } from '../../utils/media_cache';
import { renderVaultPdfPagesCached, type RenderedPdfPages } from '../../utils/pdf_render';
import type { ToolContentBlock } from '../../providers/types';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

const READ_PDF_MAX_PAGES = 120;
const READ_PDF_CHAR_CAP = 120_000;
const READ_PDF_MAX_BYTES = 50 * 1024 * 1024;

export const readPdf: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'extract text from PDF attachment',
  backfillObservableInput: normalizePathFields(['path']),
  maxResultSizeChars: Infinity,
  renderToolResultMessage(result) {
    if (result.startsWith('Error')) return null;
    const m = result.match(/^PDF:\s+(.+?)\s+\((\d+)\s+pages?,\s+read\s+(.+?),\s+(\d+)\s+chars\)/);
    if (!m) return null;
    const path = m[1];
    const totalPages = m[2];
    const pageLabel = m[3];
    const chars = m[4];
    const bodyStart = result.indexOf('---\n');
    const body = bodyStart >= 0 ? result.slice(bodyStart + 4) : result;

    const wrap = activeWindow.createDiv();
    setStyle(wrap, { padding: '6px 10px' });
    setStyle(wrap, { fontSize: '12px' });
    setStyle(wrap, { lineHeight: '1.5' });

    const header = activeWindow.createDiv();
    setStyle(header, { fontWeight: '600' });
    setStyle(header, { marginBottom: '6px' });
    header.textContent = `PDF ${path}  ·  ${totalPages} pages  ·  read ${pageLabel}  ·  ${chars} chars`;
    wrap.appendChild(header);

    const headings = [...body.matchAll(/^### Page\s+\d+/gm)].slice(0, 30).map(m => m[0]);
    if (headings.length > 0) {
      const tree = activeWindow.createDiv();
      setStyle(tree, { padding: '4px 0 6px 0' });
      setStyle(tree, { opacity: '0.85' });
      setStyle(tree, { fontSize: '11px' });
      for (const h of headings) {
        const item = activeWindow.createDiv();
        item.textContent = h;
        tree.appendChild(item);
      }
      wrap.appendChild(tree);
    }

    const det = activeWindow.createEl('details');
    const sum = activeWindow.createEl('summary');
    sum.textContent = 'Extracted text';
    setStyle(sum, { cursor: 'pointer' });
    setStyle(sum, { fontSize: '11px' });
    setStyle(sum, { opacity: '0.7' });
    det.appendChild(sum);
    const pre = activeWindow.createEl('pre');
    setStyle(pre, { fontSize: '11px' });
    setStyle(pre, { margin: '4px 0 0 0' });
    setStyle(pre, { maxHeight: '400px' });
    setStyle(pre, { overflow: 'auto' });
    pre.textContent = body.slice(0, 20_000);
    det.appendChild(pre);
    wrap.appendChild(det);
    return wrap;
  },
  describe: a => `read PDF ${a.path}`,
  spec: {
    name: 'read_pdf',
    description: 'Read one explicitly targeted vault PDF with page numbers and text-layer diagnostics. Choose inspect/rename for identity, summarize for document structure, search for a phrase, pages for a range, or full only when genuinely necessary; visual renders up to 4 requested pages for scans, figures, and formulas. Prefer attached PDF context already supplied in the prompt.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to a PDF file.' },
        mode: {
          type: 'string',
          enum: ['auto', 'inspect', 'rename', 'summarize', 'search', 'pages', 'full', 'visual'],
          description: 'Task-aware read mode. Default auto.',
        },
        query: { type: 'string', description: 'Optional search phrase. Use with mode=search or when locating specific details.' },
        pages: { type: 'string', description: 'Optional page range, e.g. "1-3", "5", or "1-3,8". Default reads from page 1 up to max_pages.' },
        max_pages: { type: 'integer', minimum: 1, maximum: READ_PDF_MAX_PAGES, description: `Maximum pages to extract. Default ${READ_PDF_MAX_PAGES}.` },
        max_chars: { type: 'integer', minimum: 1000, maximum: READ_PDF_CHAR_CAP, description: `Maximum extracted characters. Default ${READ_PDF_CHAR_CAP}.` },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  run: async (app, args, ctx) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }

    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: PDF file not found: ${path}`;
    if ((f.extension || '').toLowerCase() !== 'pdf') return `Error: not a PDF file: ${path}`;
    if ((f.stat?.size ?? 0) > READ_PDF_MAX_BYTES) {
      return `Error: PDF is too large (${humanSize(f.stat.size)} > ${humanSize(READ_PDF_MAX_BYTES)} cap): ${path}`;
    }

    try {
      const mode = normalizeMode(args.mode);
      if (mode === 'visual') {
        const { value: rendered } = await renderVaultPdfPagesCached(app, f, visualPageRange(args.pages), {
          maxPages: 4,
          signal: ctx?.signal,
        });
        return visualPdfToolResult(path, rendered);
      }
      const maxPages = clampToolNumber(args.max_pages, 1, 500, READ_PDF_MAX_PAGES);
      const maxChars = clampToolNumber(args.max_chars, 1_000, 500_000, READ_PDF_CHAR_CAP);
      const { value: res } = await extractVaultPdfCached(app, f, {
        pages: args.pages,
        maxPages,
        maxChars,
        task: mode,
        query: typeof args.query === 'string' ? args.query : undefined,
        signal: ctx?.signal,
      });
      const warnings = res.warnings.length ? `\n\nWarnings:\n${res.warnings.map(w => `- ${w}`).join('\n')}` : '';
      const diagnostic = formatPdfDiagnosticMarkdown(res);
      const body = shouldUseSearchSnippets(res, args.query)
        ? formatSearchSnippets(res)
        : res.text;
      const text = `PDF: ${path} (${res.pageCount} pages, read ${res.pageLabel}, ${res.chars} chars)\n\n${diagnostic}\n\n---\n${body || '[No extracted text returned for this mode]'}${warnings}`;
      if (!needsVisualEvidence(res, mode)) return text;
      const pages = res.pagesRead.slice(0, 2).join(',') || '1';
      const { value: rendered } = await renderVaultPdfPagesCached(app, f, pages, {
        maxPages: 2,
        signal: ctx?.signal,
      });
      return {
        text: `${text}\n\nRendered visual evidence: page(s) ${rendered.pageLabel}.`,
        contentBlocks: renderedPdfBlocks(rendered),
      };
    } catch (e) {
      return `Error extracting PDF text from ${path}: ${e?.message ?? e}`;
    }
  },
});

function clampToolNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function humanSize(b: number): string {
  if (b < 1024) return b + 'B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
  return (b / (1024 * 1024)).toFixed(1) + 'MB';
}

function normalizeMode(value: unknown): PdfReadTask | 'visual' {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'inspect' || raw === 'rename' || raw === 'summarize' || raw === 'search' || raw === 'pages' || raw === 'full' || raw === 'visual') return raw;
  if (raw === 'summary') return 'summarize';
  if (raw === 'metadata' || raw === 'title') return 'inspect';
  return 'auto';
}

function visualPageRange(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '1';
}

function needsVisualEvidence(res: PdfExtractionResult, mode: PdfReadTask): boolean {
  if (mode !== 'auto' && mode !== 'inspect' && mode !== 'summarize') return false;
  return res.diagnostic.textLayer === 'absent' || res.diagnostic.documentKind === 'complex-layout';
}

export function visualPdfToolResult(path: string, rendered: RenderedPdfPages): { text: string; contentBlocks: ToolContentBlock[] } {
  return {
    text: `PDF visual: ${path} (${rendered.totalPages} pages, rendered ${rendered.pageLabel}). Inspect the attached page images directly.`,
    contentBlocks: renderedPdfBlocks(rendered),
  };
}

export function renderedPdfBlocks(rendered: RenderedPdfPages): ToolContentBlock[] {
  const blocks: ToolContentBlock[] = [];
  for (const page of rendered.pages) {
    blocks.push({ type: 'text', text: `PDF page ${page.page} (${page.width} x ${page.height}px)` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: page.mime, data: page.data } });
  }
  return blocks;
}

function shouldUseSearchSnippets(res: PdfExtractionResult, query: unknown): boolean {
  return res.task === 'search' && typeof query === 'string' && query.trim().length > 0;
}

function formatSearchSnippets(res: PdfExtractionResult): string {
  if (!res.searchHits.length) {
    return [
      '### Search result',
      'No exact page-level hit was found in the extracted text.',
      '',
      'Use a different query, broaden the page range, or visually inspect/OCR the PDF if the diagnostic reports sparse text.',
    ].join('\n');
  }

  const lines = ['### Search result'];
  for (const hit of res.searchHits.slice(0, 20)) {
    lines.push('', `#### Page ${hit.page} (${hit.count} hit${hit.count === 1 ? '' : 's'})`);
    for (const snippet of hit.snippets.slice(0, 4)) {
      lines.push(`- ${snippet}`);
    }
  }
  return lines.join('\n');
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
