/** Own delayed plugin work so disabling the plugin cannot start new work. */
export class DeferredTasks {
  private handles = new Set<number>();
  private closed = false;

  get active(): boolean { return !this.closed; }

  schedule(action: () => void, delay: number): number | undefined {
    if (this.closed) return undefined;
    const handle = window.setTimeout(() => {
      this.handles.delete(handle);
      if (!this.closed) action();
    }, delay);
    this.handles.add(handle);
    return handle;
  }

  cancel(handle: number | null | undefined): void {
    if (handle === null || handle === undefined) return;
    window.clearTimeout(handle);
    this.handles.delete(handle);
  }

  dispose(): void {
    this.closed = true;
    for (const handle of this.handles) window.clearTimeout(handle);
    this.handles.clear();
  }
}
