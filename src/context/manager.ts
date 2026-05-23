import type { ContextItem } from '../types';

export type ContextListener = (items: ContextItem[]) => void;

/** Holds the currently-attached context items + emits change events to the UI. */
export class ContextManager {
  private items: ContextItem[] = [];
  private listeners = new Set<ContextListener>();

  list(): ContextItem[] { return [...this.items]; }
  totalTokens(): number { return this.items.reduce((a, x) => a + x.tokens, 0); }

  add(item: ContextItem) {
    // dedupe by detail+kind (same file twice → no-op)
    if (this.items.some(x => x.kind === item.kind && x.detail === item.detail && !x.isCurrent)) return;
    this.items.push(item);
    this.emit();
  }
  remove(id: string) {
    this.items = this.items.filter(x => x.id !== id);
    this.emit();
  }
  togglePin(id: string) {
    this.items = this.items.map(x => x.id === id ? { ...x, pinned: !x.pinned } : x);
    this.emit();
  }

  /** Replace any auto-attached "current" items with the new active file's content. Keeps pinned + user-added. */
  updateCurrent(newCurrent: ContextItem | null) {
    this.items = this.items.filter(x => !x.isCurrent);
    if (newCurrent) this.items.unshift(newCurrent);
    this.emit();
  }

  /** Remove non-pinned items (used after sending). */
  resetUnpinned() {
    this.items = this.items.filter(x => x.pinned || x.isCurrent);
    this.emit();
  }

  /** Build the textual context block to inject into the prompt. Excludes images.
   *
   *  Budget enforcement has TWO tiers:
   *   - soft cap (`maxTokens`): drop the largest UNPINNED, non-current items first
   *   - hard cap (`hardCap`): an absolute ceiling — if still over after dropping
   *     unpinned, also drop pinned/current items (largest first) so the prompt
   *     never blows the model's context window. `forcedDrops` reports those.
   *
   *  Without `hardCap`, behaviour is identical to the previous version.
   */
  asPromptBlock(maxTokens?: number, hardCap?: number): { text: string; dropped: ContextItem[]; forcedDrops: ContextItem[]; remaining: number } {
    const textOnly = this.items.filter(x => x.kind !== 'image');
    let kept = [...textOnly];
    const dropped: ContextItem[] = [];
    const forcedDrops: ContextItem[] = [];
    let total = kept.reduce((a, x) => a + x.tokens, 0);

    if (maxTokens && maxTokens > 0 && total > maxTokens) {
      const droppable = kept.filter(x => !x.pinned && !x.isCurrent).sort((a, b) => b.tokens - a.tokens);
      for (const d of droppable) {
        if (total <= maxTokens) break;
        const idx = kept.indexOf(d);
        if (idx >= 0) { kept.splice(idx, 1); total -= d.tokens; dropped.push(d); }
      }
    }
    if (hardCap && hardCap > 0 && total > hardCap) {
      // Even with unpinned dropped, we're still over the hard ceiling. Sacrifice
      // pinned/current items so we don't blow the model's window. Drop order
      // (least-painful first):
      //   1. pinned, non-current — user pinned but already has it visible elsewhere
      //   2. pinned, current     — last-resort
      //   3. isCurrent only (no pin) — extremely unusual at this branch
      // Within each tier, drop largest first so we recover the most budget per drop.
      const tiers: ContextItem[][] = [
        kept.filter(x => x.pinned && !x.isCurrent).sort((a, b) => b.tokens - a.tokens),
        kept.filter(x => x.isCurrent && !x.pinned).sort((a, b) => b.tokens - a.tokens),
        kept.filter(x => x.pinned && x.isCurrent).sort((a, b) => b.tokens - a.tokens),
      ];
      outer: for (const tier of tiers) {
        for (const d of tier) {
          if (total <= hardCap) break outer;
          const idx = kept.indexOf(d);
          if (idx >= 0) { kept.splice(idx, 1); total -= d.tokens; forcedDrops.push(d); }
        }
      }
    }

    if (kept.length === 0) return { text: '', dropped, forcedDrops, remaining: total };
    return { text: `<context>\n${kept.map(x => x.content).join('\n\n')}\n</context>`, dropped, forcedDrops, remaining: total };
  }

  /** Return images attached as context (for multimodal providers). */
  imagesForAPI(): { dataUri: string; name?: string }[] {
    return this.items
      .filter(x => x.kind === 'image' && x.content.startsWith('data:'))
      .map(x => ({ dataUri: x.content, name: x.label }));
  }

  on(l: ContextListener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit() { for (const l of this.listeners) l(this.list()); }
}
