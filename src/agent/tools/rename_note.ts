import type { ToolArguments } from '../tool_arguments';
import { errorMessage, scalarText } from '../../utils/unknown_data';
/**
 * rename_note — move or rename a note or a folder, preserving all wikilinks to it.
 *
 * Uses `app.fileManager.renameFile()` which is the Obsidian-blessed rename
 * path: it (a) physically moves/renames the file, (b) updates every wikilink
 * across the vault that pointed at the old name. A plain
 * `vault.rename` does NOT update backlinks — so we delegate to fileManager.
 */
import { TFile, TFolder, type App } from 'obsidian';
import { assertVaultPath, buildTool, filesInFolder, normalizePathFields, protectedVaultPath, vaultFolderOf, type ToolImpl } from './_shared';

/** The source or destination that must not be moved (vault root, configuration folder). */
function protectedMove(app: App, from: string, to: string): string | null {
  const source = protectedVaultPath(app, from);
  if (source) return `Refusing to move ${source}.`;
  const destination = protectedVaultPath(app, to);
  return destination ? `Refusing to move into ${destination}.` : null;
}

export const renameNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'rename or move a note or folder preserving wikilinks',
  searchTags: ['move file', 'rename file', 'move folder', 'rename folder', '重命名笔记', '移动文件', '移动文件夹', '重命名文件夹'],
  backfillObservableInput: normalizePathFields(['from', 'to']),
  describe: a => `rename ${scalarText(a.from)} → ${scalarText(a.to)}`,
  spec: {
    name: 'rename_note',
    description: 'Move or rename one vault file or folder through the file manager so resolvable internal links can be updated. The destination must not exist. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current vault-relative path.' },
        to:   { type: 'string', description: 'New vault-relative path.' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  preview: async (app: App, a: ToolArguments) => {
    const from: unknown = a.from;
    const source = app.vault.getAbstractFileByPath(typeof from === 'string' ? from : '');
    const what = source instanceof TFolder ? `Move folder (${filesInFolder(source).length} files)` : 'Rename';
    return `${what}:\n  ${scalarText(a.from)}\n→ ${scalarText(a.to)}\n\n(wikilinks pointing at the old path will be auto-updated)`;
  },
  // Refused before an approval card is shown.
  checkPermissions: async (app, args) => {
    try {
      const reason = protectedMove(app, assertVaultPath(args?.from, 'from'), assertVaultPath(args?.to, 'to'));
      return reason ? { behavior: 'deny', message: reason } : { behavior: 'passthrough' };
    } catch {
      return { behavior: 'passthrough' };
    }
  },
  run: async (app, args) => {
    let from: string, to: string;
    try {
      from = assertVaultPath(args.from, 'from');
      to = assertVaultPath(args.to, 'to');
    } catch (e: unknown) { return `Error: ${errorMessage(e)}`; }
    if (from === to) return 'Error: from and to are identical — nothing to rename.';
    const blocked = protectedMove(app, from, to);
    if (blocked) return `Error: ${blocked}`;
    const f = app.vault.getAbstractFileByPath(from);
    if (!(f instanceof TFile) && !(f instanceof TFolder)) return `Error: source not found: ${from}`;
    if (f instanceof TFolder && to.toLowerCase().startsWith(`${from.toLowerCase()}/`)) return `Error: cannot move a folder into itself: ${from} → ${to}`;
    if (app.vault.getAbstractFileByPath(to)) return `Error: destination already exists: ${to}`;
    try {
      const folder = vaultFolderOf(to);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
      await app.fileManager.renameFile(f, to);
      return `Renamed ${from} → ${to} (backlinks auto-updated).`;
    } catch (e: unknown) {
      return `Error: ${errorMessage(e)}`;
    }
  },
});
