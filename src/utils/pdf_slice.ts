import { PDFDocument } from 'pdf-lib';
import { parsePdfPageSelection } from './pdf';

const MAX_NATIVE_PDF_PAGES = 100;
const MAX_NATIVE_PDF_BYTES = 24 * 1024 * 1024;

export interface SlicedPdfPages {
  bytes: Uint8Array;
  totalPages: number;
  pages: number[];
  pageLabel: string;
}

export async function slicePdfPages(
  rawData: ArrayBuffer | Uint8Array,
  pageRange: unknown,
  maxPages = MAX_NATIVE_PDF_PAGES,
): Promise<SlicedPdfPages> {
  const bytes = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
  let source: PDFDocument;
  try { source = await PDFDocument.load(bytes); }
  catch (error) {
    throw new Error(`Could not load PDF for native page slicing: ${error instanceof Error ? error.message : String(error)}`);
  }
  const totalPages = source.getPageCount();
  const selection = parsePdfPageSelection(pageRange, totalPages, Math.min(MAX_NATIVE_PDF_PAGES, maxPages));
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, selection.pages.map(page => page - 1));
  for (const page of copied) target.addPage(page);
  const output = await target.save();
  if (output.byteLength > MAX_NATIVE_PDF_BYTES) {
    throw new Error(`Native PDF slice is ${(output.byteLength / 1024 / 1024).toFixed(1)} MB; limit is 24 MB.`);
  }
  return { bytes: output, totalPages, pages: selection.pages, pageLabel: selection.label };
}
