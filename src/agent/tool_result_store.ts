/**
 * Tool result persistence. When a tool's result string exceeds its declared
 * `maxResultSizeChars`, we save the full result to disk and substitute a
 * preview + reference for the model. This prevents one runaway tool (e.g. a
 * `read_note` of a 100k-char file, or a `grep_vault` hitting a giant file)
 * from blowing the context window.
 *
 * Storage: `<vault>/.glossa/tool_outputs/<tool>-<id>-<timestamp>.txt`. We keep
 * the last 50 files (FIFO) so the directory doesn't grow unbounded — older
 * results are unlinked at write time.
 *
 * Mirrors upstream Claude Code's `maxResultSizeChars` + `ContentReplacementState`
 * pattern, simplified for the in-vault adapter.
 */
import type { App } from 'obsidian';

const STORE_DIR = '.glossa/tool_outputs';
const MAX_STORED_FILES = 50;
const PREVIEW_HEAD_CHARS = 1_200;
const PREVIEW_TAIL_CHARS = 400;

export interface PersistedResult {
  /** Path to the on-disk file holding the full result. */
  path: string;
  /** Substituted preview to send to the model in place of the full text. */
  preview: string;
}

/** Sanitize a string for use as a filename. */
function sanitizeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32) || 'tool';
}

/** Rotate older files when we cross MAX_STORED_FILES. Best-effort, non-fatal. */
async function rotate(app: App): Promise<void> {
  try {
    const adapter = app.vault.adapter;
    if (!(await adapter.exists(STORE_DIR))) return;
    const listing = await adapter.list(STORE_DIR);
    const files = (listing.files ?? []).slice();
    if (files.length <= MAX_STORED_FILES) return;
    // Sort by basename (timestamp is the trailing component) ascending, then
    // unlink the oldest until we're back within the cap.
    files.sort();
    const toDelete = files.slice(0, files.length - MAX_STORED_FILES);
    for (const f of toDelete) {
      try { await adapter.remove(f); } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn('[tool_result_store] rotation failed', e);
  }
}

/** Persist `result` to disk and return a preview reference. Returns null if
 *  persistence failed (caller should fall back to truncation only). */
export async function persistLargeResult(
  app: App,
  toolName: string,
  toolCallId: string,
  result: string,
): Promise<PersistedResult | null> {
  try {
    const adapter = app.vault.adapter;
    if (!(await adapter.exists('.glossa'))) await adapter.mkdir('.glossa');
    if (!(await adapter.exists(STORE_DIR))) await adapter.mkdir(STORE_DIR);

    const ts = Date.now();
    const filename = `${ts}-${sanitizeName(toolName)}-${sanitizeName(toolCallId).slice(0, 8)}.txt`;
    const path = `${STORE_DIR}/${filename}`;
    await adapter.write(path, result);
    // Fire-and-forget rotation.
    rotate(app).catch(() => {});

    // Build a head+tail preview. The head gives the model immediate context;
    // the tail catches summaries / "found N results" lines often appended.
    const head = result.slice(0, PREVIEW_HEAD_CHARS);
    const tail = result.length > PREVIEW_HEAD_CHARS + PREVIEW_TAIL_CHARS
      ? result.slice(-PREVIEW_TAIL_CHARS)
      : '';
    const elided = result.length - head.length - tail.length;
    const preview =
      `[tool result persisted to ${path} — ${result.length.toLocaleString()} chars total, showing head + tail]\n` +
      `\n--- HEAD (${head.length} chars) ---\n${head}` +
      (tail
        ? `\n--- … (${elided.toLocaleString()} chars elided) …\n--- TAIL (${tail.length} chars) ---\n${tail}`
        : '') +
      `\n[end preview — read ${path} for the full result]`;

    return { path, preview };
  } catch (e) {
    console.warn('[tool_result_store] persist failed', e);
    return null;
  }
}
