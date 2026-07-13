import type { App, TFile } from 'obsidian';
import {
  extractPdfTextFromArrayBuffer,
  type PdfExtractionOptions,
  type PdfExtractionResult,
} from './pdf';
import {
  bytesToBase64,
  inspectImageArrayBuffer,
  type ImageInspectionOptions,
  type ImageInspectionResult,
} from './image';

interface AsyncCacheEntry<T> {
  promise: Promise<T>;
  weight: number;
}

export interface AsyncCacheResult<T> {
  value: T;
  cacheHit: boolean;
}

export interface AsyncCacheStats {
  entries: number;
  weight: number;
  hits: number;
  misses: number;
}

/** Bounded LRU for expensive async work. The promise is cached immediately,
 * so concurrent callers share one read/extraction instead of racing duplicate
 * PDF.js or base64 work. Failed promises remove themselves. */
export class BoundedAsyncCache<T> {
  private entries = new Map<string, AsyncCacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number,
    private readonly weigh: (value: T) => number,
  ) {}

  async getOrCreate(key: string, load: () => Promise<T>): Promise<AsyncCacheResult<T>> {
    const existing = this.entries.get(key);
    if (existing) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, existing);
      return { value: await existing.promise, cacheHit: true };
    }

    this.misses++;
    const entry: AsyncCacheEntry<T> = { promise: Promise.resolve().then(load), weight: 0 };
    this.entries.set(key, entry);
    this.trim(key);
    entry.promise = entry.promise.then(value => {
      entry.weight = Math.max(0, this.weigh(value));
      this.trim(key);
      return value;
    }).catch(reason => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw asError(reason, 'Cached operation failed.');
    });
    return { value: await entry.promise, cacheHit: false };
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): AsyncCacheStats {
    return {
      entries: this.entries.size,
      weight: this.totalWeight(),
      hits: this.hits,
      misses: this.misses,
    };
  }

  private trim(protectedKey: string): void {
    while (this.entries.size > this.maxEntries || this.totalWeight() > this.maxWeight) {
      let oldestKey: string | undefined;
      for (const key of this.entries.keys()) {
        oldestKey = key;
        break;
      }
      if (!oldestKey) return;
      if (oldestKey === protectedKey && this.entries.size === 1) return;
      this.entries.delete(oldestKey);
    }
  }

  private totalWeight(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.weight;
    return total;
  }
}

const pdfCache = new BoundedAsyncCache<PdfExtractionResult>(16, 3_000_000, result => result.text.length);
const imageCache = new BoundedAsyncCache<string>(24, 32 * 1024 * 1024, dataUri => dataUri.length);
const imageInspectionCache = new BoundedAsyncCache<ImageInspectionResult>(12, 32 * 1024 * 1024, result => result.image.data.length);

export function vaultFileFingerprint(file: Pick<TFile, 'path' | 'stat'>): string {
  return `${file.path}\u0000${file.stat.mtime}\u0000${file.stat.size}`;
}

export async function extractVaultPdfCached(
  app: App,
  file: TFile,
  options: PdfExtractionOptions = {},
): Promise<AsyncCacheResult<PdfExtractionResult>> {
  const { signal, ...sharedOptions } = options;
  const key = `${vaultFileFingerprint(file)}\u0000${pdfOptionsKey(sharedOptions)}`;
  const shared = pdfCache.getOrCreate(key, async () => {
    const data = await app.vault.readBinary(file);
    return extractPdfTextFromArrayBuffer(data, sharedOptions);
  });
  return awaitWithAbortSignal(shared, signal, 'PDF extraction aborted.');
}

export async function vaultImageDataUriCached(
  app: App,
  file: TFile,
  mime: string,
): Promise<AsyncCacheResult<string>> {
  const key = `${vaultFileFingerprint(file)}\u0000${mime}`;
  return imageCache.getOrCreate(key, async () => {
    const data = await app.vault.readBinary(file);
    return `data:${mime};base64,${bytesToBase64(new Uint8Array(data))}`;
  });
}

export async function inspectVaultImageCached(
  app: App,
  file: TFile,
  mime: string,
  options: ImageInspectionOptions = {},
): Promise<AsyncCacheResult<ImageInspectionResult>> {
  const key = `${vaultFileFingerprint(file)}\u0000${mime}\u0000${stableImageOptions(options)}`;
  return imageInspectionCache.getOrCreate(key, async () => {
    const data = await app.vault.readBinary(file);
    return inspectImageArrayBuffer(data, mime, options);
  });
}

export function clearMediaCaches(): void {
  pdfCache.clear();
  imageCache.clear();
  imageInspectionCache.clear();
}

export function mediaCacheStats(): { pdf: AsyncCacheStats; image: AsyncCacheStats; imageInspection: AsyncCacheStats } {
  return { pdf: pdfCache.stats(), image: imageCache.stats(), imageInspection: imageInspectionCache.stats() };
}

/** Let each caller stop waiting without cancelling shared cached work needed by
 * other callers. The shared promise keeps its own success/failure lifecycle. */
export async function awaitWithAbortSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  message = 'Operation aborted.',
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError(message);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError(message));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      reason => {
        signal.removeEventListener('abort', onAbort);
        reject(asError(reason, 'Shared operation failed.'));
      },
    );
  });
}

function pdfOptionsKey(options: PdfExtractionOptions): string {
  return JSON.stringify([
    options.pages ?? '',
    options.maxPages ?? null,
    options.maxChars ?? null,
    options.task ?? 'auto',
    options.query ?? '',
  ]);
}

function stableImageOptions(options: ImageInspectionOptions): string {
  return JSON.stringify(stableValue([
    options.mode ?? 'auto',
    options.region ?? null,
    options.samplePoints ?? null,
  ]));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) output[key] = stableValue(input[key]);
  return output;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function asError(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === 'string' && reason ? reason : fallback);
}
