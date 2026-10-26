/** The PDF.js surface used from Obsidian's untyped loadPdfJs host API. */
export interface PdfJsTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}
export interface PdfJsTextContent { items?: PdfJsTextItem[] }
export interface PdfJsViewport { width: number; height: number }
export interface PdfJsPage {
  getTextContent(): Promise<PdfJsTextContent>;
  getViewport(options: { scale: number }): PdfJsViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }): { promise: Promise<void> };
  cleanup?(): unknown;
}
export interface PdfJsDocument {
  numPages?: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  getMetadata?(): Promise<{ info?: { Title?: unknown; title?: unknown } }> | { info?: { Title?: unknown; title?: unknown } };
  destroy?(): void | Promise<void>;
}
export interface PdfJsLibrary {
  getDocument(options: { data: Uint8Array; useWorkerFetch: boolean; isEvalSupported: boolean }): {
    promise: Promise<PdfJsDocument>;
    destroy?(): void | Promise<void>;
  };
}
