/** Several chats can run at once. A write tool holds the lock of every note it
 *  touches from its before-snapshot until its after-snapshot, so two chats
 *  editing the same note take turns instead of interleaving read-modify-write
 *  steps. Locks for one call are queued in a single synchronous step, which
 *  keeps the per-path order consistent and cannot deadlock. */
const tails = new Map<string, Promise<void>>();

function lockKey(path: string): string {
  // Obsidian treats paths case-insensitively on macOS/Windows; sharing a lock
  // between case variants only costs a short wait.
  return path.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
}

/** Wait for earlier holders of `paths`, then return a release function. */
export async function acquireFileLocks(paths: readonly string[]): Promise<() => void> {
  const keys = [...new Set(paths.filter(Boolean).map(lockKey))];
  if (!keys.length) return () => {};
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const earlier: Promise<void>[] = [];
  for (const key of keys) {
    const previous = tails.get(key) ?? Promise.resolve();
    earlier.push(previous);
    const mine = previous.then(() => held);
    tails.set(key, mine);
    void mine.then(() => { if (tails.get(key) === mine) tails.delete(key); });
  }
  await Promise.all(earlier);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

/** Paths currently locked or waited for; for tests and diagnostics. */
export function lockedPathCount(): number {
  return tails.size;
}
