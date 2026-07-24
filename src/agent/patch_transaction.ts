import { TFile, type App } from 'obsidian';
import { applyUpdateDetailed, type FileOp } from './patch_envelope';
import { describeTextMatches, textFingerprint } from './text_edit_engine';
import { vaultFolderOf } from './tools/_shared';

export interface PatchFileStore {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
}

export interface PatchSnapshot {
  path: string;
  content: string | null;
  fingerprint: string | null;
}

export interface PlannedPatchOperation {
  kind: FileOp['kind'];
  sourcePath: string;
  targetPath: string;
  before: string | null;
  after: string | null;
  matchSummary?: string;
}

export interface PatchTransactionPlan {
  operations: PlannedPatchOperation[];
  snapshots: PatchSnapshot[];
}

export type PatchCommitResult =
  | { ok: true; touched: string[] }
  | { ok: false; error: string; rolledBack: boolean; rollbackErrors: string[] };

function fingerprint(content: string | null): string | null {
  return content === null ? null : textFingerprint(content);
}

/** Materialize every after-state before the first write and reject path conflicts. */
export async function materializePatchTransaction(ops: FileOp[], store: PatchFileStore): Promise<PatchTransactionPlan> {
  const claims = new Map<string, string>();
  const snapshots = new Map<string, PatchSnapshot>();
  const claim = (path: string, owner: string) => {
    const previous = claims.get(path);
    if (previous && previous !== owner) throw new Error(`path conflict: ${path} is used by both ${previous} and ${owner}`);
    claims.set(path, owner);
  };
  const snapshot = async (path: string): Promise<PatchSnapshot> => {
    const existing = snapshots.get(path);
    if (existing) return existing;
    const content = await store.read(path);
    const value = { path, content, fingerprint: fingerprint(content) };
    snapshots.set(path, value);
    return value;
  };

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    const owner = `${op.kind} operation ${index + 1}`;
    claim(op.path, owner);
    if (op.kind === 'update' && op.movePath && op.movePath !== op.path) claim(op.movePath, owner);
  }

  const operations: PlannedPatchOperation[] = [];
  for (const op of ops) {
    if (op.kind === 'add') {
      const current = await snapshot(op.path);
      if (current.content !== null) throw new Error(`Add File: ${op.path} already exists`);
      operations.push({ kind: 'add', sourcePath: op.path, targetPath: op.path, before: null, after: op.contents });
      continue;
    }

    const current = await snapshot(op.path);
    if (current.content === null) throw new Error(`${op.kind === 'delete' ? 'Delete' : 'Update'} File: ${op.path} not found`);
    if (op.kind === 'delete') {
      operations.push({ kind: 'delete', sourcePath: op.path, targetPath: op.path, before: current.content, after: null });
      continue;
    }

    const targetPath = op.movePath && op.movePath !== op.path ? op.movePath : op.path;
    if (targetPath !== op.path) {
      const target = await snapshot(targetPath);
      if (target.content !== null) throw new Error(`Move target already exists: ${targetPath}`);
    }
    const result = applyUpdateDetailed(current.content, op.chunks);
    operations.push({
      kind: 'update',
      sourcePath: op.path,
      targetPath,
      before: current.content,
      after: result.content,
      matchSummary: describeTextMatches(result.edits),
    });
  }
  return { operations, snapshots: Array.from(snapshots.values()) };
}

async function verifySnapshots(plan: PatchTransactionPlan, store: PatchFileStore): Promise<void> {
  for (const expected of plan.snapshots) {
    const current = await store.read(expected.path);
    if (fingerprint(current) !== expected.fingerprint) {
      throw new Error(`${expected.path} changed after preview; patch was not started`);
    }
  }
}

async function restoreSnapshots(plan: PatchTransactionPlan, store: PatchFileStore): Promise<string[]> {
  const errors: string[] = [];
  for (const snapshot of [...plan.snapshots].reverse()) {
    try {
      const current = await store.read(snapshot.path);
      if (current !== null) await store.remove(snapshot.path);
    } catch (error) {
      errors.push(`remove ${snapshot.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const snapshot of plan.snapshots) {
    if (snapshot.content === null) continue;
    try {
      await store.write(snapshot.path, snapshot.content);
    } catch (error) {
      errors.push(`restore ${snapshot.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

/** Verify all fingerprints, commit sequentially, and restore the full snapshot on failure. */
export async function commitPatchTransaction(plan: PatchTransactionPlan, store: PatchFileStore): Promise<PatchCommitResult> {
  try {
    await verifySnapshots(plan, store);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), rolledBack: false, rollbackErrors: [] };
  }

  const touched: string[] = [];
  try {
    for (const operation of plan.operations) {
      if (operation.kind === 'add') {
        await store.write(operation.targetPath, operation.after ?? '');
        touched.push(`+${operation.targetPath}`);
      } else if (operation.kind === 'delete') {
        await store.remove(operation.sourcePath);
        touched.push(`-${operation.sourcePath}`);
      } else {
        await store.write(operation.sourcePath, operation.after ?? '');
        if (operation.targetPath !== operation.sourcePath) {
          await store.move(operation.sourcePath, operation.targetPath);
        }
        touched.push(`~${operation.targetPath}`);
      }
    }
    return { ok: true, touched };
  } catch (error) {
    const rollbackErrors = await restoreSnapshots(plan, store);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      rolledBack: rollbackErrors.length === 0,
      rollbackErrors,
    };
  }
}

export function obsidianPatchFileStore(app: App): PatchFileStore {
  return {
    read: async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) return null;
      if (!(file instanceof TFile)) throw new Error(`${path} is not a file`);
      return await app.vault.read(file);
    },
    write: async (path, content) => {
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await app.vault.modify(existing, content);
        return;
      }
      if (existing) throw new Error(`${path} is not a file`);
      const folder = vaultFolderOf(path);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* already exists */ }
      await app.vault.create(path, content);
    },
    remove: async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`${path} not found`);
      await app.fileManager.trashFile(file);
    },
    move: async (from, to) => {
      const file = app.vault.getAbstractFileByPath(from);
      if (!(file instanceof TFile)) throw new Error(`${from} not found`);
      const folder = vaultFolderOf(to);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* already exists */ }
      await app.fileManager.renameFile(file, to);
    },
  };
}
