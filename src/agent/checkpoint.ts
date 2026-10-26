import type { ToolArguments } from './tool_arguments';
import { errorMessage } from '../utils/unknown_data';
import { TFile, TFolder, type App } from 'obsidian';
import type GlossaPlugin from '../main';
import { filesInFolder } from './tools/_shared';
import { textFingerprint } from './text_edit_engine';
import { summarizeFileChange, type FileChangeSummary } from '../utils/edit_summary';

export interface FileSnapshot {
  path: string;
  existed: boolean;
  contentBefore: string | null;
  takenAt: number;
  after?: { fingerprint: string | null; change: FileChangeSummary | null };
  restoredAt?: number;
  /** Renames and non-text files cannot be fully restored by text snapshots. */
  undoBlocked?: boolean;
  /** Part of a call that touched too many files to keep their content. */
  contentSkipped?: boolean;
}

/** A call that touches more than this (a large folder deleted or moved) keeps
 *  no copies; its files stay recoverable from the trash. */
const MAX_SNAPSHOT_FILES = 300;
const MAX_SNAPSHOT_CHARS = 8_000_000;

export interface SessionCheckpoint {
  sessionId: string;
  turnId: string;
  takenAt: number;
  snapshots: FileSnapshot[];
}

function isTextSnapshotPath(path: string): boolean {
  return /\.(?:md|markdown|txt|canvas|base|json|jsonl|ya?ml|csv|tsv|xml|html?|css|js|ts|log|tex|bib|svg)$/i.test(path);
}

/**
 * Lightweight checkpoint manager: before each dangerous tool call we snapshot the target
 * file's current content into <plugin>/checkpoints.json.
 * Post-tool metadata describes the result; undo checks for intervening edits.
 */
export class CheckpointManager {
  private path: string;
  /** FIFO write queue. Every read-modify-write op (snapshot, purge, rollback)
   *  chains onto `writeChain` so two concurrent destructive tools can't both
   *  read the same entries, modify their own copies, and write back, losing
   *  one set of snapshots. The chain swallows errors so a single failure
   *  doesn't poison the queue for subsequent ops. */
  private writeChain: Promise<void> = Promise.resolve();
  private withWriteMu<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(() => {}, () => {});
    return next;
  }

  constructor(private plugin: GlossaPlugin) {
    this.path = `${plugin.manifest.dir}/checkpoints.json`;
  }

  private async read(): Promise<SessionCheckpoint[]> {
    try {
      if (await this.plugin.app.vault.adapter.exists(this.path)) {
        const raw = await this.plugin.app.vault.adapter.read(this.path);
        const dec = await this.plugin.decryptBlob(raw);
        const parsed = JSON.parse(dec) as { entries?: SessionCheckpoint[] };
        const entries: SessionCheckpoint[] = Array.isArray(parsed?.entries) ? parsed.entries : [];
        // Drop checkpoints older than 7 days.
        const cutoff = Date.now() - 7 * 24 * 3600_000;
        const kept = entries.filter(e => e.takenAt > cutoff);
        return kept;
      }
    } catch (e: unknown) {
      // Don't fall back silently — without a log the "rollback button isn't
      // working" bug report has no breadcrumb.
      console.warn('[Glossa] checkpoint read failed; rollback unavailable for this turn', e);
    }
    return [];
  }
  private async write(entries: SessionCheckpoint[]) {
    try {
      const json = JSON.stringify({ entries });
      const payload = await this.plugin.encryptBlob(json);
      // Atomic write — concurrent destructive tools queue through writeMu
      // (see snapshot()) but a crash mid-write would still corrupt the
      // file without safeWrite's tmp+rename. Checkpoint payload is already
      // encrypted; safeWrite treats it as opaque string.
      const { safeWrite } = await import('../utils/safe_write');
      await safeWrite(this.plugin.app.vault.adapter, this.path, payload);
    } catch (e: unknown) {
      console.warn('[Glossa] checkpoint write failed', e);
    }
  }

  /** Manually purge everything. */
  async purgeAll() {
    return this.withWriteMu(async () => {
      try {
        const payload = await this.plugin.encryptBlob(JSON.stringify({ entries: [] }));
        const { safeWrite } = await import('../utils/safe_write');
        await safeWrite(this.plugin.app.vault.adapter, this.path, payload);
      } catch (e: unknown) { console.warn('[Glossa] checkpoint purge failed', e); }
    });
  }

  /** Snapshot a file (or its absence) before a destructive tool runs. */
  async snapshot(sessionId: string, turnId: string, paths: string[]) {
    if (!this.plugin.settings.checkpointEnabled) return;
    // Critical section: two concurrent destructive tools must serialise their
    // read-modify-write. Without this lock, two snapshots within the same
    // (sessionId, turnId) — or within different turns — race on the JSON file
    // and the second writer overwrites the first's mutation.
    return this.withWriteMu(async () => {
      const entries = await this.read();
      let entry = entries.find(e => e.sessionId === sessionId && e.turnId === turnId);
      if (!entry) {
        entry = { sessionId, turnId, takenAt: Date.now(), snapshots: [] };
        entries.push(entry);
      }
      const fresh = paths.filter(p => !entry.snapshots.some(s => s.path === p));     // already snapshotted this turn
      let budget = fresh.length > MAX_SNAPSHOT_FILES ? -1 : MAX_SNAPSHOT_CHARS;
      for (const p of fresh) {
        const f = this.plugin.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFolder) continue;
        if (!(f instanceof TFile)) {
          entry.snapshots.push({ path: p, existed: false, contentBefore: null, takenAt: Date.now(), undoBlocked: !isTextSnapshotPath(p) });
          continue;
        }
        const content = budget >= 0 && (f.stat?.size ?? 0) <= budget ? await this.plugin.app.vault.read(f) : null;
        if (content === null || content.length > budget) {
          entry.snapshots.push({ path: p, existed: true, contentBefore: null, takenAt: Date.now(), undoBlocked: true, contentSkipped: true });
          continue;
        }
        budget -= content.length;
        entry.snapshots.push({ path: p, existed: true, contentBefore: content, takenAt: Date.now(), undoBlocked: !isTextSnapshotPath(p) });
      }
      // Cap to last 200 turn-checkpoints to bound disk
      while (entries.length > 200) entries.shift();
      await this.write(entries);
    });
  }

  async listForSession(sessionId: string): Promise<SessionCheckpoint[]> {
    await this.writeChain;
    return (await this.read()).filter(e => e.sessionId === sessionId);
  }

  /** Record the actual post-tool state, including partial writes after a failure. */
  async recordAfter(sessionId: string, turnId: string, paths: string[], undoBlocked = false): Promise<void> {
    return this.withWriteMu(async () => {
      const entries = await this.read();
      const entry = entries.find(e => e.sessionId === sessionId && e.turnId === turnId);
      if (!entry) return;
      for (const snapshot of entry.snapshots.filter(s => paths.includes(s.path))) {
        // A file whose content was not kept is compared by presence only.
        const content = snapshot.contentSkipped
          ? (this.plugin.app.vault.getAbstractFileByPath(snapshot.path) instanceof TFile ? '' : null)
          : await this.readFile(snapshot.path);
        snapshot.after = {
          fingerprint: content === null ? null : textFingerprint(content),
          change: summarizeFileChange(snapshot.existed ? snapshot.contentBefore ?? '' : null, content),
        };
        if ((!isTextSnapshotPath(snapshot.path) || snapshot.contentSkipped) && snapshot.after.change) {
          snapshot.after.change.adds = null;
          snapshot.after.change.dels = null;
          snapshot.undoBlocked = true;
        }
        snapshot.undoBlocked ||= undoBlocked;
        delete snapshot.restoredAt;
      }
      await this.write(entries);
    });
  }

  private async ensureFolder(path: string) {
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      const existing = this.plugin.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${current} is not a folder`);
      await this.plugin.app.vault.createFolder(current);
    }
  }

  private async readFile(path: string): Promise<string | null> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return this.plugin.app.vault.read(file);
    if (file) throw new Error(`Path is not a file: ${path}`);
    return null;
  }

  /** Restore selected files only while their contents still match this turn's result. */
  async rollback(sessionId: string, turnId: string, paths?: string[]): Promise<{ restored: number; failed: string[] }> {
    return this.withWriteMu(async () => {
    const entries = await this.read();
    const entry = entries.find(e => e.sessionId === sessionId && e.turnId === turnId);
    if (!entry) return { restored: 0, failed: [] };
    const snapshots = entry.snapshots.filter(s => !s.restoredAt && (!paths || paths.includes(s.path))
      && (!s.after || s.after.change));
    const current = new Map<string, string | null>();
    // Preflight all selected paths before writing any of them.
    for (const s of snapshots) {
      if (!s.after || s.undoBlocked) return { restored: 0, failed: [`${s.path}: no verifiable undo snapshot`] };
      try {
        const content = await this.readFile(s.path);
        if ((content === null ? null : textFingerprint(content)) !== s.after.fingerprint) {
          return { restored: 0, failed: [`${s.path}: changed since this turn; kept current content`] };
        }
        current.set(s.path, content);
      } catch (error: unknown) {
        return { restored: 0, failed: [`${s.path}: ${errorMessage(error)}`] };
      }
    }
    let restored = 0; const failed: string[] = [];
    for (const s of snapshots) {
      try {
        const f = this.plugin.app.vault.getAbstractFileByPath(s.path);
        if (s.existed) {
          if (f instanceof TFile) await this.plugin.app.vault.process(f, content => {
            if (content !== current.get(s.path)) throw new Error('File changed during undo; kept current content');
            return s.contentBefore ?? '';
          });
          else {
            if (f || current.get(s.path) !== null) throw new Error('File changed during undo');
            // A file from a deleted folder needs its folders back first.
            await this.ensureFolder(s.path.split('/').slice(0, -1).join('/'));
            await this.plugin.app.vault.create(s.path, s.contentBefore ?? '');
          }
        } else {
          if (!(f instanceof TFile) || await this.plugin.app.vault.read(f) !== current.get(s.path)) {
            throw new Error('File changed during undo; kept current content');
          }
          await this.plugin.app.fileManager.trashFile(f);
        }
        s.restoredAt = Date.now();
        restored++;
      } catch (e: unknown) { failed.push(`${s.path}: ${errorMessage(e)}`); }
    }
    await this.write(entries);
    return { restored, failed };
    });
  }
}

/** pathsTouchedByTool with folders opened up: deleting or moving a folder
 *  touches every file in it, and moved files reappear under the new path.
 *  Call before the tool runs, while the folder still exists. */
export function filesTouchedByTool(app: App, name: string, args: ToolArguments): string[] {
  const paths = pathsTouchedByTool(name, args);
  const clean = (value: unknown) => typeof value === 'string' ? value.replace(/^\.\//, '').trim().replace(/\/+$/, '') : '';
  const source = clean(name === 'delete_note' ? args?.path : name === 'rename_note' ? args?.from : undefined);
  const folder = source ? app.vault.getAbstractFileByPath(source) : null;
  if (!(folder instanceof TFolder)) return paths;
  const files = filesInFolder(folder).map(file => file.path);
  if (name === 'delete_note') return files;
  const to = clean(args?.to);
  return [...files, ...(to ? files.map(path => to + path.slice(folder.path.length)) : [])];
}

/** Returns the file paths a dangerous tool would touch — used to know what to snapshot. */
export function pathsTouchedByTool(name: string, args: ToolArguments): string[] {
  switch (name) {
    // Single-file operations with a `path` arg, including phase 1 surgical
    // tools.
    case 'write_note':
    case 'create_note':
    case 'append_to_note':
    case 'edit_section':
    case 'delete_note':
    case 'patch_note':
    case 'manage_frontmatter':
    case 'manage_tags':
    case 'patch_canvas':
      return args.path ? [args.path] : [];
    case 'rename_note':
      // Both source and destination are touched (source disappears, dest appears).
      return [args.from, args.to].filter((path): path is string => typeof path === 'string' && !!path);
    case 'templater_render':
      // Only writes the target. The template itself is read-only.
      return args.target_path ? [args.target_path] : [];
    case 'file_edit':
      return args.file_path ? [args.file_path] : [];
    case 'apply_patch': {
      // Envelope branch may touch multiple files
      if (typeof args.patch === 'string' && /^\s*\*\*\* Begin Patch/.test(args.patch)) {
        const paths: string[] = [];
        const re = /^\*\*\* (Add File|Delete File|Update File): (.+)$/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(args.patch)) !== null) paths.push(m[2].trim());
        // Also include move-target if any
        const reMove = /^\*\*\* Move to: (.+)$/gm;
        while ((m = reMove.exec(args.patch)) !== null) paths.push(m[1].trim());
        return paths;
      }
      return args.path ? [args.path] : [];
    }
    default: return [];
  }
}
