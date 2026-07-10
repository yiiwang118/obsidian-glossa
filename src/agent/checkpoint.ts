/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import type GlossaPlugin from '../main';

export interface FileSnapshot {
  path: string;
  existed: boolean;
  contentBefore: string | null;
  takenAt: number;
}

export interface SessionCheckpoint {
  sessionId: string;
  turnId: string;
  takenAt: number;
  snapshots: FileSnapshot[];
}

/**
 * Lightweight checkpoint manager: before each dangerous tool call we snapshot the target
 * file's current content into <plugin>/checkpoints/<sessionId>.json (append-only).
 * Rollback restores any chosen turn.
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
        const parsed = JSON.parse(dec);
        const entries: SessionCheckpoint[] = Array.isArray(parsed?.entries) ? parsed.entries : [];
        // Drop checkpoints older than 7 days.
        const cutoff = Date.now() - 7 * 24 * 3600_000;
        const kept = entries.filter(e => e.takenAt > cutoff);
        return kept;
      }
    } catch (e) {
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
    } catch (e) {
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
      } catch (e) { console.warn('[Glossa] checkpoint purge failed', e); }
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
      for (const p of paths) {
        if (entry.snapshots.find(s => s.path === p)) continue;     // already snapshotted this turn
        const f = this.plugin.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) {
          const content = await this.plugin.app.vault.read(f);
          entry.snapshots.push({ path: p, existed: true, contentBefore: content, takenAt: Date.now() });
        } else {
          entry.snapshots.push({ path: p, existed: false, contentBefore: null, takenAt: Date.now() });
        }
      }
      // Cap to last 200 turn-checkpoints to bound disk
      while (entries.length > 200) entries.shift();
      await this.write(entries);
    });
  }

  async listForSession(sessionId: string): Promise<SessionCheckpoint[]> {
    return (await this.read()).filter(e => e.sessionId === sessionId);
  }

  /** Restore everything captured in this turn. */
  async rollback(sessionId: string, turnId: string): Promise<{ restored: number; failed: string[] }> {
    const entries = await this.read();
    const entry = entries.find(e => e.sessionId === sessionId && e.turnId === turnId);
    if (!entry) return { restored: 0, failed: [] };
    let restored = 0; const failed: string[] = [];
    for (const s of entry.snapshots) {
      try {
        const f = this.plugin.app.vault.getAbstractFileByPath(s.path);
        if (s.existed) {
          if (f instanceof TFile) await this.plugin.app.vault.modify(f, s.contentBefore ?? '');
          else await this.plugin.app.vault.create(s.path, s.contentBefore ?? '');
          restored++;
        } else {
          if (f instanceof TFile) await this.plugin.app.fileManager.trashFile(f);
          restored++;
        }
      } catch (e) { failed.push(`${s.path}: ${e.message}`); }
    }
    return { restored, failed };
  }
}

/** Returns the file paths a dangerous tool would touch — used to know what to snapshot. */
export function pathsTouchedByTool(name: string, args: AnyValue): string[] {
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
      return [args.from, args.to].filter(Boolean);
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- Re-enable review lint rules after dynamic boundary module. */
