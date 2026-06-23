import { TFile } from 'obsidian';
import { extractPdfTextFromArrayBuffer } from '../../utils/pdf';
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
  renderToolResultMessage(result, _args) {
    if (result.startsWith('Error')) return null;
    const m = result.match(/^PDF:\s+(.+?)\s+\((\d+)\s+pages?,\s+read\s+(.+?),\s+(\d+)\s+chars\)/);
    if (!m) return null;
    const path = m[1];
    const totalPages = m[2];
    const pageLabel = m[3];
    const chars = m[4];
    const bodyStart = result.indexOf('---\n');
    const body = bodyStart >= 0 ? result.slice(bodyStart + 4) : result;

    const wrap = document.createElement('div');
    wrap.style.padding = '6px 10px';
    wrap.style.fontSize = '12px';
    wrap.style.lineHeight = '1.5';

    const header = document.createElement('div');
    header.style.fontWeight = '600';
    header.style.marginBottom = '6px';
    header.textContent = `PDF ${path}  ·  ${totalPages} pages  ·  read ${pageLabel}  ·  ${chars} chars`;
    wrap.appendChild(header);

    const headings = [...body.matchAll(/^### Page\s+\d+/gm)].slice(0, 30).map(m => m[0]);
    if (headings.length > 0) {
      const tree = document.createElement('div');
      tree.style.padding = '4px 0 6px 0';
      tree.style.opacity = '0.85';
      tree.style.fontSize = '11px';
      for (const h of headings) {
        const item = document.createElement('div');
        item.textContent = h;
        tree.appendChild(item);
      }
      wrap.appendChild(tree);
    }

    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'extracted text';
    sum.style.cursor = 'pointer';
    sum.style.fontSize = '11px';
    sum.style.opacity = '0.7';
    det.appendChild(sum);
    const pre = document.createElement('pre');
    pre.style.fontSize = '11px';
    pre.style.margin = '4px 0 0 0';
    pre.style.maxHeight = '400px';
    pre.style.overflow = 'auto';
    pre.textContent = body.slice(0, 20_000);
    det.appendChild(pre);
    wrap.appendChild(det);
    return wrap;
  },
  describe: a => `read PDF ${a.path}`,
  spec: {
    name: 'read_pdf',
    description: [
      'Extract text from a PDF file in the vault. Use this for PDF attachments, papers, reports, and books.',
      'Returns text grouped by page. For scanned/image-only PDFs it may return little or no text.',
      'Use pages for targeted reads, e.g. "1-3", "5", or "1-3,8".',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to a PDF file.' },
        pages: { type: 'string', description: 'Optional page range, e.g. "1-3", "5", or "1-3,8". Default reads from page 1 up to max_pages.' },
        max_pages: { type: 'number', description: `Maximum pages to extract. Default ${READ_PDF_MAX_PAGES}.` },
        max_chars: { type: 'number', description: `Maximum extracted characters. Default ${READ_PDF_CHAR_CAP}.` },
      },
      required: ['path'],
    },
  },
  run: async (app, args, ctx) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }

    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: PDF file not found: ${path}`;
    if ((f.extension || '').toLowerCase() !== 'pdf') return `Error: not a PDF file: ${path}`;
    if ((f.stat?.size ?? 0) > READ_PDF_MAX_BYTES) {
      return `Error: PDF is too large (${humanSize(f.stat.size)} > ${humanSize(READ_PDF_MAX_BYTES)} cap): ${path}`;
    }

    try {
      const buf = await app.vault.readBinary(f);
      const maxPages = clampToolNumber(args.max_pages, 1, 500, READ_PDF_MAX_PAGES);
      const maxChars = clampToolNumber(args.max_chars, 1_000, 500_000, READ_PDF_CHAR_CAP);
      const res = await extractPdfTextFromArrayBuffer(buf, {
        pages: args.pages,
        maxPages,
        maxChars,
        signal: ctx?.signal,
      });
      const warnings = res.warnings.length ? `\n\nWarnings:\n${res.warnings.map(w => `- ${w}`).join('\n')}` : '';
      return `PDF: ${path} (${res.pageCount} pages, read ${res.pageLabel}, ${res.chars} chars)\n\n---\n${res.text}${warnings}`;
    } catch (e: any) {
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
