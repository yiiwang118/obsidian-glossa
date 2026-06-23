/**
 * Plugin bridge registration — detect-then-register.
 *
 * Each "bridge tool" (dataview_query / templater_render / tasks_query /
 * bases_query) only makes sense when the upstream Obsidian plugin is
 * actually loaded. We probe `app.plugins.plugins[<id>]` at plugin init AND
 * subscribe to Obsidian's plugin-enabled / plugin-disabled events so the
 * tool registry stays in sync if the user toggles plugins mid-session.
 *
 * The bridge tool files (`bridge_dataview.ts`, etc.) export a `ToolImpl`
 * that's safe to call even when the upstream plugin isn't loaded — they
 * return a clear "plugin not installed" error. The detect layer hides them
 * from the model's tool list when unavailable, so the model never sees a
 * tool it can't successfully invoke.
 */
import type { App } from 'obsidian';

/** One row in the bridge registry. */
export interface BridgeDescriptor {
  /** Tool name in TOOLS registry. */
  toolName: string;
  /** plugin id under app.plugins.plugins[<id>] to probe. Empty string means
   *  "always-on built-in" (e.g. Bases). */
  pluginId: string;
  /** Human-friendly label for logs / UI. */
  label: string;
  /** Predicate: when does the bridge consider the upstream "available"?
   *  Defaults to plugin being loaded AND enabled. Useful for plugins whose
   *  API is only ready after a deferred init (Dataview, Templater). */
  isReady?: (app: App) => boolean;
}

/** Master list of bridges Glossa knows about. Order = listing precedence. */
export const BRIDGE_DESCRIPTORS: BridgeDescriptor[] = [
  {
    toolName: 'dataview_query',
    pluginId: 'dataview',
    label: 'Dataview',
    isReady: (app) => !!(app as any).plugins?.plugins?.['dataview']?.api,
  },
  {
    toolName: 'templater_render',
    pluginId: 'templater-obsidian',
    label: 'Templater',
    isReady: (app) => {
      const t = (app as any).plugins?.plugins?.['templater-obsidian'];
      return !!t?.templater;
    },
  },
  {
    toolName: 'tasks_query',
    pluginId: 'obsidian-tasks-plugin',
    label: 'Tasks',
    isReady: (app) => {
      const t = (app as any).plugins?.plugins?.['obsidian-tasks-plugin'];
      // Tasks plugin exposes apiV1 (and earlier apiV0); accept either.
      return !!(t?.apiV1 || t?.api);
    },
  },
  {
    toolName: 'bases_query',
    pluginId: '',                       // built-in (Obsidian 1.9+)
    label: 'Bases',
    isReady: (app) => {
      // Bases is core; available iff Obsidian build supports .base files.
      // We can't truly probe at module-import time (the .base type registry
      // is internal to Obsidian), so we just confirm an app-shaped object
      // exists. Defensive `?.` chain so a malformed/partial app (mock, hot
      // reload, plugin disable racing init) doesn't TypeError before the
      // workspace finishes loading.
      return !!app?.vault?.adapter;
    },
  },
];

/** Set of currently-active bridge tool names. Recomputed on every probe. */
const activeBridges = new Set<string>();

/** Listeners notified when the active set changes (so the agent loop can
 *  rebuild its tool spec list). */
const listeners = new Set<() => void>();

export function onBridgeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch (e) { console.warn('[plugin-bridges] listener threw', e); }
  }
}

/** Probe every bridge against the current app state. Returns the diff. */
export function probeBridges(app: App): { added: string[]; removed: string[] } {
  const previous = new Set(activeBridges);
  const now = new Set<string>();
  for (const desc of BRIDGE_DESCRIPTORS) {
    const ready = desc.isReady ? desc.isReady(app) : true;
    if (ready) now.add(desc.toolName);
  }
  const added: string[] = [];
  const removed: string[] = [];
  for (const n of now) if (!previous.has(n)) added.push(n);
  for (const n of previous) if (!now.has(n)) removed.push(n);
  activeBridges.clear();
  for (const n of now) activeBridges.add(n);
  if (added.length || removed.length) notify();
  return { added, removed };
}

/** True iff the bridge with this tool name is currently active. The agent
 *  loop's tool filter uses this to hide unavailable bridges from the model. */
export function isBridgeActive(toolName: string): boolean {
  return activeBridges.has(toolName);
}

/** Set of all tool names registered as bridges (regardless of active state).
 *  Used by the filter so it knows WHICH tools to gate on isBridgeActive. */
export function allBridgeToolNames(): readonly string[] {
  return BRIDGE_DESCRIPTORS.map(d => d.toolName);
}

/** Test-only: reset active set + listeners + handlers. Production code MUST
 *  NOT call this; it's wired here so unit tests can isolate state between
 *  cases. Kept named with leading `__` so a grep makes it obvious it's a
 *  test seam. */
export function __resetForTests(): void {
  activeBridges.clear();
  listeners.clear();
}

/** Initialise: probe once, then subscribe to enable/disable events. Returns
 *  the unsubscribe function. Call from the plugin's `onLayoutReady`. */
export function watchPluginBridges(app: App): () => void {
  probeBridges(app);
  const handlers: Array<() => void> = [];
  const events = app.workspace as any;
  const subscribe = (name: string) => {
    const h = events.on?.(name, () => probeBridges(app));
    if (h) handlers.push(() => events.offref?.(h));
  };
  // These two are Obsidian internal events. Defensive try/catch — if a future
  // version renames them, we still degrade gracefully.
  try { subscribe('plugins:plugin-enabled'); } catch { /* ignore */ }
  try { subscribe('plugins:plugin-disabled'); } catch { /* ignore */ }
  // Re-probe on layout change too (some plugins finish init after layout).
  try {
    const h = (app as any).workspace.onLayoutReady?.(() => probeBridges(app));
    if (h) handlers.push(() => {});
  } catch { /* ignore */ }
  return () => {
    for (const off of handlers) {
      try { off(); } catch { /* ignore */ }
    }
  };
}
