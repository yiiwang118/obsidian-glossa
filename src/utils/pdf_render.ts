/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- PDF.js is a dynamic host boundary validated before use. */
import { loadPdfJs, type App, type TFile } from 'obsidian';
import {
  awaitWithAbortSignal,
  BoundedAsyncCache,
  vaultFileFingerprint,
  type AsyncCacheResult,
} from './media_cache';
import { parsePdfPageSelection } from './pdf';

export interface RenderedPdfPage {
  page: number;
  mime: 'image/jpeg';
  data: string;
  width: number;
  height: number;
}

export interface RenderedPdfPages {
  totalPages: number;
  pageLabel: string;
  pages: RenderedPdfPage[];
}

const MAX_VISUAL_PAGES = 4;
const DEFAULT_SCALE = 1.7;
const MAX_PIXEL_AREA = 12_000_000;
const renderedPageCache = new BoundedAsyncCache<RenderedPdfPages>(8, 40 * 1024 * 1024, result =>
  result.pages.reduce((total, page) => total + page.data.length, 0));

export async function renderVaultPdfPagesCached(
  app: App,
  file: TFile,
  pageRange = '1',
  options: { maxPages?: number; scale?: number; signal?: AbortSignal } = {},
): Promise<AsyncCacheResult<RenderedPdfPages>> {
  const maxPages = clamp(options.maxPages ?? MAX_VISUAL_PAGES, 1, MAX_VISUAL_PAGES);
  const scale = clamp(options.scale ?? DEFAULT_SCALE, 0.75, 2.5);
  const key = `${vaultFileFingerprint(file)}\u0000${pageRange}\u0000${maxPages}\u0000${scale}`;
  const shared = renderedPageCache.getOrCreate(key, async () => {
    const data = await app.vault.readBinary(file);
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data).slice(),
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    let doc: AnyValue = null;
    try {
      doc = await loadingTask.promise;
      const totalPages = Math.max(0, Number(doc?.numPages) || 0);
      const selection = parsePdfPageSelection(pageRange, totalPages, maxPages);
      const pages: RenderedPdfPage[] = [];
      for (let index = 0; index < selection.pages.length; index++) {
        if (index > 0) await yieldToMain();
        const pageNumber = selection.pages[index];
        const page = await doc.getPage(pageNumber);
        try {
          const initialViewport = page.getViewport({ scale });
          const initialArea = Math.max(1, initialViewport.width * initialViewport.height);
          const safeScale = initialArea > MAX_PIXEL_AREA
            ? scale * Math.sqrt(MAX_PIXEL_AREA / initialArea)
            : scale;
          const viewport = safeScale === scale ? initialViewport : page.getViewport({ scale: safeScale });
          const canvas = activeWindow.createEl('canvas');
          try {
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            const context = canvas.getContext('2d');
            if (!context) throw new Error(`Could not create a canvas for PDF page ${pageNumber}.`);
            await page.render({ canvasContext: context, viewport }).promise;
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl);
            if (!match) throw new Error(`Could not encode PDF page ${pageNumber}.`);
            pages.push({
              page: pageNumber,
              mime: 'image/jpeg',
              data: match[1],
              width: canvas.width,
              height: canvas.height,
            });
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        } finally {
          try { page?.cleanup?.(); } catch { /* best effort */ }
        }
      }
      return { totalPages, pageLabel: selection.label, pages };
    } finally {
      try { await doc?.destroy?.(); } catch { /* best effort */ }
      try { await loadingTask?.destroy?.(); } catch { /* best effort */ }
    }
  });
  return awaitWithAbortSignal(shared, options.signal, 'PDF rendering aborted.');
}

export function clearRenderedPdfPageCache(): void {
  renderedPageCache.clear();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function yieldToMain(): Promise<void> {
  await new Promise<void>(resolve => window.setTimeout(resolve, 0));
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after PDF.js boundary. */
