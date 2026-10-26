import type { App, EventRef, Workspace } from 'obsidian';
import { dataRecord } from './unknown_data';

/** Optional host extensions, kept separate from the documented Obsidian API. */
export function hostSettings(app: App) {
  return (app as App & { setting?: { open(): void; openTabById(id: string): void } }).setting;
}
export function installedPlugin(app: App, id: string): Record<string, unknown> {
  return dataRecord(dataRecord(dataRecord(dataRecord(app).plugins).plugins)[id]);
}
export function onHostEvent(workspace: Workspace, name: string, callback: () => void): EventRef {
  return (workspace as unknown as { on(name: string, callback: () => void): EventRef }).on(name, callback);
}
/** Legacy IME signal retained for hosts that report the commit Enter through keyCode. */
export function legacyKeyCode(event: KeyboardEvent): number {
  return (event as unknown as { keyCode?: number }).keyCode ?? 0;
}
