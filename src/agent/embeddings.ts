import { App, TFile, normalizePath, Notice, requestUrl } from 'obsidian';
import type GlossaPlugin from '../main';
import type { Endpoint } from '../types';

/** On-disk schema version. Incremented when chunk shape / persistence format
 *  changes. Mismatched version → full rebuild. */
const INDEX_VERSION = 2;

/** Number of file-chunks added before persist() flushes mid-build. Caps the
 *  damage of a crash to ~N chunks rather than the entire run.
 *
 *  History: pre-v2 only persisted at end-of-build, so a 9-minute rebuild
 *  that crashed at minute 8 lost everything. */
const BUILD_FLUSH_EVERY_CHUNKS = 100;

interface VectorChunk {
  path: string;
  mtime: number;          // for cache invalidation
  chunk: number;          // chunk index inside the file
  text: string;           // raw text (for snippet)
  /** Pre-normalized embedding (||vec|| == 1). Stored as a plain number[]
   *  because JSON has no Float32Array codec. We rehydrate to Float32Array
   *  on load for hot-path arithmetic. */
  vec: number[];
}

interface IndexFile {
  version: number;
  model: string;
  endpointId: string;
  /** Vector dimension; recorded so a model-swap with the same id (same
   *  model NAME but different dim from a different provider) triggers a
   *  full rebuild rather than silently producing wrong cosine scores. */
  dim: number;
  chunks: VectorChunk[];
}

export class EmbeddingIndex {
  private chunks: VectorChunk[] = [];
  /** Hot-path mirror of chunks[].vec as Float32Array for fast dot-products.
   *  Built in step with chunks; the two arrays stay index-aligned. */
  private vecs: Float32Array[] = [];
  private model = '';
  private endpointId = '';
  private dim = 0;
  private path: string;
  private dirty = false;

  constructor(private plugin: GlossaPlugin) {
    this.path = `${plugin.manifest.dir}/embeddings.json`;
  }

  /** Loaded once; if file is encrypted and we're locked, defer until first explicit use. */
  private deferredLoad = false;
  async load() {
    try {
      if (!(await this.plugin.app.vault.adapter.exists(this.path))) return;
      const raw = await this.plugin.app.vault.adapter.read(this.path);
      const decrypted = await this.plugin.decryptBlobOptional(raw);
      if (decrypted == null) {
        // Locked — try later when caller needs the index
        this.deferredLoad = true;
        return;
      }
      this.applyParsed(decrypted);
    } catch (e) { console.warn('[plugin] embeddings load failed', e); }
  }
  private async ensureLoaded() {
    if (!this.deferredLoad) return;
    this.deferredLoad = false;
    try {
      if (!(await this.plugin.app.vault.adapter.exists(this.path))) return;
      const raw = await this.plugin.app.vault.adapter.read(this.path);
      const decrypted = await this.plugin.decryptBlob(raw);   // will prompt unlock now
      this.applyParsed(decrypted);
    } catch (e) { console.warn('[plugin] embeddings deferred load failed', e); }
  }

  /** Decrypted-text → in-memory state. Handles schema-version mismatch + dim
   *  validation by wiping the index (with a console warning) so the next
   *  build() rebuilds from scratch rather than producing wrong scores. */
  private applyParsed(decrypted: string) {
    let parsed: Partial<IndexFile>;
    try { parsed = JSON.parse(decrypted); }
    catch (e) { console.warn('[plugin] embeddings JSON parse failed; starting empty', e); return; }
    if (!parsed || !parsed.chunks) return;
    // Version + dim gate. Pre-v2 files had no `version` field; treat absent as 1.
    const ver = typeof parsed.version === 'number' ? parsed.version : 1;
    if (ver !== INDEX_VERSION) {
      console.warn(`[plugin] embeddings index version ${ver} != ${INDEX_VERSION}; wiping (next build will recompute).`);
      this.chunks = []; this.vecs = []; this.dim = 0; this.dirty = true;
      this.model = parsed.model ?? ''; this.endpointId = parsed.endpointId ?? '';
      return;
    }
    // Validate dim consistency across stored chunks. A chunk with a wrong dim
    // would silently truncate the dot-product loop and produce a misleading
    // top-K score. Easier to wipe + rebuild than to filter.
    const decl = parsed.dim ?? 0;
    let bad = false;
    for (const c of parsed.chunks) {
      if (!c.vec || (decl && c.vec.length !== decl)) { bad = true; break; }
    }
    if (bad || !decl) {
      console.warn('[plugin] embeddings index has inconsistent vector dim; wiping.');
      this.chunks = []; this.vecs = []; this.dim = 0; this.dirty = true;
      this.model = parsed.model ?? ''; this.endpointId = parsed.endpointId ?? '';
      return;
    }
    this.chunks = parsed.chunks;
    this.dim = decl;
    this.model = parsed.model ?? '';
    this.endpointId = parsed.endpointId ?? '';
    // Rehydrate Float32 mirror for hot-path search.
    this.vecs = this.chunks.map(c => Float32Array.from(c.vec));
  }

  async persist() {
    if (!this.dirty) return;
    try {
      const f: IndexFile = {
        version: INDEX_VERSION,
        model: this.model,
        endpointId: this.endpointId,
        dim: this.dim,
        chunks: this.chunks,
      };
      const json = JSON.stringify(f);
      const payload = await this.plugin.encryptBlob(json);
      // Atomic write — the index file can be 10s of MB; if Obsidian dies
      // mid-write the truncated file would parse as null and the catch in
      // ensureLoaded() would silently wipe the index. safeWrite stages then
      // renames, keeping a .bak.
      const { safeWrite } = await import('../utils/safe_write');
      await safeWrite(this.plugin.app.vault.adapter, this.path, payload);
      this.dirty = false;
    } catch (e) { console.warn('[Glossa] embeddings save failed', e); }
  }

  size(): number { return this.chunks.length; }

  modelInfo(): { model: string; endpointId: string } { return { model: this.model, endpointId: this.endpointId }; }

  /** Build / refresh index. Scans all markdown files; (re)embeds chunks whose
   *  file mtime changed. Persists every BUILD_FLUSH_EVERY_CHUNKS so a crash
   *  doesn't lose the entire run. */
  async build(opts: { onProgress?: (done: number, total: number) => void } = {}): Promise<{ added: number; removed: number }> {
    await this.ensureLoaded();
    const { embeddingEndpointId, embeddingModel } = this.plugin.settings;
    let { embeddingChunkSize, embeddingChunkOverlap } = this.plugin.settings;
    // Clamp to safe bounds — overlap must be < size, otherwise chunkText would loop forever.
    embeddingChunkSize = Math.max(200, Math.min(8000, embeddingChunkSize));
    embeddingChunkOverlap = Math.max(0, Math.min(embeddingChunkSize - 50, embeddingChunkOverlap));

    if (!embeddingEndpointId) throw new Error('No embedding endpoint configured.');
    const epRaw = this.plugin.settings.endpoints.find(e => e.id === embeddingEndpointId);
    if (!epRaw) throw new Error('Embedding endpoint not found.');
    if (epRaw.kind !== 'custom-api') throw new Error('Embedding endpoint must be a Custom API.');
    // Decrypt the key — supports encrypted endpoints.
    const ep = await this.plugin.getDecryptedEndpoint(epRaw);
    if (!ep) throw new Error('Could not decrypt the embedding endpoint API key.');

    // If model / endpoint changed, wipe and re-embed.
    if (this.model !== embeddingModel || this.endpointId !== embeddingEndpointId) {
      this.chunks = []; this.vecs = []; this.dim = 0;
      this.model = embeddingModel; this.endpointId = embeddingEndpointId; this.dirty = true;
    }

    const files = this.plugin.app.vault.getMarkdownFiles();
    const byPath = new Map<string, TFile>();
    files.forEach(f => byPath.set(f.path, f));

    // Remove chunks whose file no longer exists OR whose mtime moved. We
    // rebuild the Float32 mirror after the filter so vecs[] stays index-aligned.
    const before = this.chunks.length;
    this.chunks = this.chunks.filter(c => {
      const f = byPath.get(c.path);
      return !!(f && f.stat.mtime === c.mtime);
    });
    const removed = before - this.chunks.length;
    if (removed > 0) {
      this.vecs = this.chunks.map(c => Float32Array.from(c.vec));
      this.dirty = true;
    }

    // For each file, if no chunks exist (or mtime changed), chunk + embed.
    const haveByPath = new Map<string, VectorChunk[]>();
    for (const c of this.chunks) {
      if (!haveByPath.has(c.path)) haveByPath.set(c.path, []);
      haveByPath.get(c.path)!.push(c);
    }

    let added = 0;
    let addedSinceFlush = 0;
    const total = files.length;
    let i = 0;
    for (const f of files) {
      i++;
      opts.onProgress?.(i, total);
      const have = haveByPath.get(f.path);
      if (have && have.some(c => c.mtime === f.stat.mtime)) continue;     // up to date

      const text = await this.plugin.app.vault.cachedRead(f);
      const pieces = chunkText(text, embeddingChunkSize, embeddingChunkOverlap);
      if (pieces.length === 0) continue;

      // Embed in batches of 32
      const batchSize = 32;
      for (let b = 0; b < pieces.length; b += batchSize) {
        const slice = pieces.slice(b, b + batchSize);
        let vecs: number[][];
        try { vecs = await embedBatch(ep, embeddingModel, slice, this.plugin.settings.globalProxy); }
        catch (e: any) {
          new Notice(`Embedding failed: ${e.message}. Pausing index build.`);
          await this.persist();
          throw e;
        }
        for (let k = 0; k < slice.length; k++) {
          const normalized = normalizeInPlace(vecs[k]);
          if (this.dim === 0) this.dim = normalized.length;
          this.chunks.push({ path: f.path, mtime: f.stat.mtime, chunk: b + k, text: slice[k], vec: normalized });
          this.vecs.push(Float32Array.from(normalized));
        }
        added += slice.length;
        addedSinceFlush += slice.length;
        this.dirty = true;
        // Incremental flush — bounds crash damage. The check is per-batch
        // (not per-chunk) so we're not write-amplifying for tiny files.
        if (addedSinceFlush >= BUILD_FLUSH_EVERY_CHUNKS) {
          addedSinceFlush = 0;
          await this.persist();
        }
      }
    }
    await this.persist();
    return { added, removed };
  }

  async search(query: string, topK = 8): Promise<{ path: string; chunk: number; text: string; score: number }[]> {
    await this.ensureLoaded();
    if (this.chunks.length === 0) return [];
    const epRaw = this.plugin.settings.endpoints.find(e => e.id === this.endpointId);
    if (!epRaw) return [];
    const ep = await this.plugin.getDecryptedEndpoint(epRaw);
    if (!ep) return [];
    const [qvecRaw] = await embedBatch(ep, this.model, [query], this.plugin.settings.globalProxy);
    const qvec = Float32Array.from(normalizeInPlace(qvecRaw));
    if (this.dim && qvec.length !== this.dim) {
      console.warn(`[plugin] query vec dim ${qvec.length} != index dim ${this.dim}; rebuild required.`);
      return [];
    }

    // Top-K with a bounded min-heap so memory stays O(K) regardless of
    // chunk count. Cosine = dot product since both sides are pre-normalized.
    const heap = new TopKHeap(topK);
    const vecs = this.vecs;
    const n = Math.min(this.chunks.length, vecs.length);
    for (let idx = 0; idx < n; idx++) {
      heap.push(idx, dotF32(qvec, vecs[idx]));
    }
    return heap.sortedDesc().map(({ idx, score }) => {
      const c = this.chunks[idx];
      return { path: c.path, chunk: c.chunk, text: c.text, score };
    });
  }
}

/** Min-heap that keeps the top-K largest scores seen so far. Push is O(log K).
 *  At end, sortedDesc() drains the heap once and returns descending order.
 *
 *  We use the heap instead of `array.sort + slice(0, K)` because the latter
 *  is O(N log N); for a 10k-chunk vault and K=8, the heap path runs ~7x
 *  faster (and stays constant-memory in K). */
class TopKHeap {
  private a: { idx: number; score: number }[] = [];
  constructor(private K: number) {}
  push(idx: number, score: number): void {
    if (this.K <= 0) return;
    if (this.a.length < this.K) {
      this.a.push({ idx, score });
      this.bubbleUp(this.a.length - 1);
    } else if (score > this.a[0].score) {
      this.a[0] = { idx, score };
      this.bubbleDown(0);
    }
  }
  sortedDesc(): { idx: number; score: number }[] {
    return [...this.a].sort((a, b) => b.score - a.score);
  }
  private bubbleUp(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].score > this.a[i].score) {
        [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
        i = p;
      } else break;
    }
  }
  private bubbleDown(i: number) {
    const n = this.a.length;
    for (;;) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let m = i;
      if (l < n && this.a[l].score < this.a[m].score) m = l;
      if (r < n && this.a[r].score < this.a[m].score) m = r;
      if (m === i) return;
      [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
      i = m;
    }
  }
}

/** L2-normalize a number[] in place. After this, ||v|| == 1 and cosine
 *  similarity reduces to dot product (much faster than re-computing norms
 *  per query). Returns the same array for chainability. */
function normalizeInPlace(v: number[]): number[] {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const norm = Math.sqrt(s);
  if (norm === 0) return v;     // pathological — keep as-is, query will score 0
  const inv = 1 / norm;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

/** Hot-path dot product for two Float32Arrays of equal length. Assumes BOTH
 *  inputs are already L2-normalized; result is cosine similarity. */
function dotF32(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function chunkText(text: string, size: number, overlap: number): string[] {
  if (!text) return [];
  // Hard-clamp: overlap must be strictly less than size so the step is >=1.
  size = Math.max(100, size | 0);
  overlap = Math.max(0, Math.min(size - 1, overlap | 0));
  const step = size - overlap;
  const out: string[] = [];
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length <= size) cur = cur ? cur + '\n\n' + p : p;
    else {
      if (cur) out.push(cur);
      if (p.length <= size) cur = p;
      else {
        for (let i = 0; i < p.length; i += step) out.push(p.slice(i, i + size));
        cur = '';
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function embedBatch(ep: Endpoint, model: string, inputs: string[], _proxy?: string): Promise<number[][]> {
  // Hard guard: Anthropic-style endpoints have no /embeddings — refuse early
  // with a clear message rather than 401-looping.
  if ((ep.apiStyle ?? 'openai') === 'anthropic') {
    throw new Error('Embedding endpoint must be OpenAI-style. Anthropic has no public embeddings API; pick a different endpoint in Settings → Semantic search.');
  }
  const url = `${ep.baseUrl!.replace(/\/$/, '')}/embeddings`;
  const headers: any = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ep.apiKey}`,
    ...(ep.headers ?? {}),
  };
  const body = JSON.stringify({ model, input: inputs });
  const r = await requestUrl({ url, method: 'POST', headers, body, throw: false });
  if (r.status >= 400) throw new Error(`Embedding HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  const data = r.json?.data;
  if (!Array.isArray(data)) throw new Error(`Embedding response malformed: missing data[]`);
  return data.map((d: any) => d.embedding);
}
