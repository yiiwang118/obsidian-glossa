/**
 * Per-vault skill-usage frequency tracking. We record every successful
 * `skill` tool invocation and use the counts to bias the skill listing so
 * frequently-used skills surface first in the budget-aware listing.
 *
 * Storage: `<vault>/.glossa/skill_usage.json`. Schema: { [name]: { count, lastUsed } }.
 * Writes are best-effort (try/catch); if persistence fails we keep the
 * in-memory cache and let the next session start fresh.
 */
import type { App } from 'obsidian';

interface UsageEntry {
  count: number;
  lastUsed: number;
}

interface UsageFile {
  version: 1;
  entries: Record<string, UsageEntry>;
}

const USAGE_PATH = '.glossa/skill_usage.json';

let cache: Record<string, UsageEntry> | null = null;
let loaded = false;

async function ensureLoaded(app: App): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const { safeReadJson } = await import('../utils/safe_write');
    const parsed = await safeReadJson<Partial<UsageFile>>(app.vault.adapter, USAGE_PATH);
    if (parsed && parsed.entries) { cache = { ...parsed.entries }; return; }
  } catch (e) {
    console.warn('[skill_usage] failed to load, starting fresh', e);
  }
  cache = {};
}

async function flush(app: App): Promise<void> {
  if (!cache) return;
  try {
    const adapter = app.vault.adapter;
    // Ensure parent dir exists.
    if (!(await adapter.exists('.glossa'))) {
      await adapter.mkdir('.glossa');
    }
    const data: UsageFile = { version: 1, entries: cache };
    // Atomic write — usage counts are small but accumulated; a corrupted
    // file would reset the frequency ranking silently.
    const { safeWriteJson } = await import('../utils/safe_write');
    await safeWriteJson(adapter, USAGE_PATH, data, { pretty: true });
  } catch (e) {
    console.warn('[skill_usage] flush failed', e);
  }
}

/** Record one invocation. Side-effect-only — fire and forget. */
export function recordSkillUsage(app: App, name: string): void {
  // We don't await; persistence is best-effort.
  void (async () => {
    await ensureLoaded(app);
    if (!cache) cache = {};
    const prev = cache[name];
    cache[name] = {
      count: (prev?.count ?? 0) + 1,
      lastUsed: Date.now(),
    };
    await flush(app);
  })();
}

/** Read usage counts. Returns a copy so callers can't mutate the cache. */
export async function getSkillUsage(app: App): Promise<Record<string, UsageEntry>> {
  await ensureLoaded(app);
  return { ...(cache ?? {}) };
}

/** Sort skills high-frequency first; ties broken by lastUsed (recent first).
 *  Skills with zero usage retain their input order (stable sort), which the
 *  caller is expected to have pre-sorted (e.g. alphabetical). */
export function sortByFrequency<T extends { name: string }>(
  skills: T[],
  usage: Record<string, UsageEntry>,
): T[] {
  return [...skills].sort((a, b) => {
    const ua = usage[a.name];
    const ub = usage[b.name];
    if (!ua && !ub) return 0;
    if (!ua) return 1;
    if (!ub) return -1;
    if (ua.count !== ub.count) return ub.count - ua.count;
    return ub.lastUsed - ua.lastUsed;
  });
}
