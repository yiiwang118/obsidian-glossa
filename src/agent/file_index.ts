/**
 * Lightweight in-memory vault index inspired by upstream Claude Code's
 * native-ts/file-index. We keep:
 *   - All markdown paths (always)
 *   - First-line preview per file (lazy, cached)
 *
 * The index yields to the event loop every N files so a full vault rescan doesn't
 * freeze Obsidian on large vaults. Incremental updates hook into vault events.
 */
import type { App, Plugin, TFile } from 'obsidian';
import { TFile as TFileCls } from 'obsidian';

const YIELD_EVERY = 64;     // pause every N files so the UI thread stays responsive

export interface FileIndexEntry {
  path: string;
  basename: string;
  mtime: number;
  size: number;
  preview?: string;      // first ~200 chars, populated lazily
}

export class FileIndex {
  private entries = new Map<string, FileIndexEntry>();
  private listening = false;
  private rebuildPromise: Promise<void> | null = null;

  constructor(private app: App) {}

  /** Total indexed paths. */
  size(): number { return this.entries.size; }

  /** Subscribe to vault events for incremental updates. Idempotent.
   *
   *  Pass the owning `Plugin` so registrations go through
   *  `plugin.registerEvent(...)` — Obsidian then unbinds them on plugin
   *  unload / hot reload, preventing the old listener set from accumulating
   *  with every reload (which would otherwise leak references to a dead
   *  `this` and double-upsert into a stale map on every vault event).
   *
   *  When `plugin` is omitted (e.g. test harness) we fall back to direct
   *  `.on()` calls and assume the caller manages lifecycle.
   */
  startListening(plugin?: Plugin) {
    if (this.listening) return;
    this.listening = true;
    const v = this.app.vault;
    this.app.workspace.onLayoutReady(() => {
      this.rebuild();
    });

    // Helper that prefers plugin.registerEvent (proper cleanup on unload)
    // but falls back to plain .on() when no plugin is supplied.
    const bind = (handler: any) => {
      if (plugin && typeof plugin.registerEvent === 'function') {
        plugin.registerEvent(handler);
      }
      // If no plugin: nothing to do — the handler is already wired by .on().
    };

    bind((v as any).on?.('create', (f: TFile) => this.upsert(f)));
    bind((v as any).on?.('delete', (f: TFile) => this.entries.delete(f.path)));
    bind((v as any).on?.('rename', (f: TFile, oldPath: string) => {
      this.entries.delete(oldPath);
      this.upsert(f);
    }));
    bind((v as any).on?.('modify', (f: TFile) => this.upsert(f, /* invalidatePreview */ true)));
  }

  private async upsert(f: TFile, invalidatePreview = false) {
    if (f.extension !== 'md') return;
    // Defer to after any in-flight rebuild so we never race against `clear()`.
    if (this.rebuildPromise) await this.rebuildPromise;
    const prev = this.entries.get(f.path);
    this.entries.set(f.path, {
      path: f.path,
      basename: f.basename,
      mtime: f.stat.mtime,
      size: f.stat.size,
      preview: invalidatePreview ? undefined : prev?.preview,
    });
  }

  /** Rebuild from scratch — yields to the event loop every YIELD_EVERY files. */
  async rebuild(): Promise<void> {
    if (this.rebuildPromise) return this.rebuildPromise;
    this.rebuildPromise = (async () => {
      const files = this.app.vault.getMarkdownFiles();
      // Build the next snapshot OFF to the side, then swap atomically. Without
      // this, an `upsert` arriving mid-rebuild would either land in the
      // half-cleared map (and get blown away) or land after clear() but before
      // the loop reaches its path. The waiting in upsert() above plus this
      // swap make both paths safe.
      const next = new Map<string, FileIndexEntry>();
      let i = 0;
      for (const f of files) {
        next.set(f.path, {
          path: f.path,
          basename: f.basename,
          mtime: f.stat.mtime,
          size: f.stat.size,
        });
        if (++i % YIELD_EVERY === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
      this.entries = next;
    })();
    try { await this.rebuildPromise; }
    finally { this.rebuildPromise = null; }
  }

  /** Snapshot all entries (sorted by path for stable output). */
  list(): FileIndexEntry[] {
    return [...this.entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Stream entries filtered by an optional path-prefix or glob. Async-iterable so
   *  long scans don't block the UI. */
  async *scan(filter?: (e: FileIndexEntry) => boolean): AsyncGenerator<FileIndexEntry> {
    let i = 0;
    for (const entry of this.entries.values()) {
      if (filter && !filter(entry)) continue;
      yield entry;
      if (++i % YIELD_EVERY === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  /** Populate the preview field for an entry on demand. */
  async ensurePreview(entry: FileIndexEntry): Promise<string> {
    if (entry.preview != null) return entry.preview;
    const f = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(f instanceof TFileCls)) { entry.preview = ''; return ''; }
    try {
      const text = await this.app.vault.cachedRead(f);
      entry.preview = text.slice(0, 200);
    } catch {
      entry.preview = '';
    }
    return entry.preview;
  }
}
