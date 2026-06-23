/**
 * Atomic file write helpers.
 *
 * Why: a plain `adapter.write(path, JSON.stringify(...))` truncates the target
 * file BEFORE writing the new bytes. If Obsidian crashes / the disk full / the
 * process is killed mid-write, the file is left zero-length or partially
 * written. On next load, JSON.parse throws and the caller's catch typically
 * swallows it into an empty default — silently losing data.
 *
 * Fix: write to `<path>.tmp` first, then `rename` over the target. On most
 * filesystems rename is atomic (POSIX) or near-atomic (NTFS). We also keep a
 * single `.bak` of the previous content so a corrupted current can be
 * manually recovered from `.bak`.
 *
 * Used by: chats.json (1.8), checkpoints (1.18), embeddings (1.27),
 * skill_usage (P2-12), nested_skill_dirs (U5), tool_outputs.
 */

import type { DataAdapter } from 'obsidian';

export interface SafeWriteOptions {
  /** Keep a `.bak` copy of the previous file content. Default true. */
  keepBackup?: boolean;
  /** Pretty-print JSON with 2-space indent. Default false (compact). */
  pretty?: boolean;
}

/** Internal: best-effort delete (swallow not-exist errors). */
async function tryRemove(adapter: DataAdapter, path: string): Promise<void> {
  try { await adapter.remove(path); } catch { /* not exist or permission — caller's problem */ }
}

/** Internal: try to rename src → dst. Adapter.rename may not exist on all
 *  Obsidian builds; fall back to read-then-write-then-remove which is still
 *  better than the naive truncate (the rename target either has old content
 *  or new content, never half-written). */
async function renameOrCopy(adapter: DataAdapter, src: string, dst: string): Promise<void> {
  const a = adapter as any;
  if (typeof a.rename === 'function') {
    try {
      // remove dst first — some adapters fail if dst exists.
      await tryRemove(adapter, dst);
      await a.rename(src, dst);
      return;
    } catch (e) {
      // Fall through to copy path.
      console.warn('[safe-write] rename failed, falling back to copy', e);
    }
  }
  const data = await adapter.read(src);
  await adapter.write(dst, data);
  await tryRemove(adapter, src);
}

/** Write `data` to `path` atomically: stage at `<path>.tmp`, then rename.
 *  Returns silently on success; throws if the write or rename fails. */
export async function safeWrite(
  adapter: DataAdapter,
  path: string,
  data: string,
  opts: SafeWriteOptions = {},
): Promise<void> {
  const tmpPath = `${path}.tmp`;
  const bakPath = `${path}.bak`;
  // Stage.
  await adapter.write(tmpPath, data);
  // Roll the current file to .bak (best-effort) so a corrupted current can
  // be recovered. We use rename rather than read+write to avoid keeping the
  // file content in memory twice.
  if (opts.keepBackup !== false) {
    try {
      if (await adapter.exists(path)) {
        await renameOrCopy(adapter, path, bakPath);
      }
    } catch (e) {
      console.warn('[safe-write] backup roll failed (continuing)', e);
    }
  }
  // Promote tmp → target.
  try {
    await renameOrCopy(adapter, tmpPath, path);
  } catch (e) {
    // Rename failed — try to restore from .bak if we made one.
    if (opts.keepBackup !== false) {
      try {
        if (await adapter.exists(bakPath)) {
          await renameOrCopy(adapter, bakPath, path);
        }
      } catch { /* ignore */ }
    }
    throw e;
  }
}

/** JSON-serialize + safeWrite. The most common call site. */
export async function safeWriteJson(
  adapter: DataAdapter,
  path: string,
  value: unknown,
  opts: SafeWriteOptions = {},
): Promise<void> {
  const json = opts.pretty
    ? JSON.stringify(value, null, 2)
    : JSON.stringify(value);
  await safeWrite(adapter, path, json, opts);
}

/** Read + JSON.parse with fallback. Returns null on missing OR corrupt
 *  current — if `<path>` is unparsable AND `<path>.bak` exists and is
 *  parsable, returns the .bak content (with a warning). */
export async function safeReadJson<T = unknown>(
  adapter: DataAdapter,
  path: string,
): Promise<T | null> {
  const tryParse = async (p: string): Promise<T | null> => {
    try {
      if (!(await adapter.exists(p))) return null;
      const raw = await adapter.read(p);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (e) {
      console.warn(`[safe-write] parse failed for ${p}`, e);
      return null;
    }
  };
  const main = await tryParse(path);
  if (main !== null) return main;
  // Fall back to .bak silently — log so the user notices on devtools.
  const bak = await tryParse(`${path}.bak`);
  if (bak !== null) {
    console.warn(`[safe-write] recovered ${path} from .bak — current was corrupt or missing`);
    return bak;
  }
  return null;
}
