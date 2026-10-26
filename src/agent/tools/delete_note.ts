import type { ToolArguments } from '../tool_arguments';
import { errorMessage } from '../../utils/unknown_data';
import { TFile, TFolder, type App } from 'obsidian';
import { assertVaultPath, buildTool, filesInFolder, normalizePathFields, protectedVaultPath, type ToolImpl } from './_shared';
import { bi } from '../../utils/i18n';

function targetPath(args: ToolArguments): string | null {
  try { return assertVaultPath(args?.path); } catch { return null; }
}

export const deleteNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'trash a file or a whole folder',
  searchTags: ['delete file', 'delete folder', 'remove note', '删除笔记', '删除文件', '删除文件夹', '移到废纸篓'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => bi(`DELETE ${a.path}`, `删除 ${a.path}`),
  preview: async (app: App, a: ToolArguments) => {
    const target = app.vault.getAbstractFileByPath(targetPath(a) ?? '');
    if (target instanceof TFolder) {
      const count = filesInFolder(target).length;
      return `⚠ Delete folder and everything in it (${count} file${count === 1 ? '' : 's'})\n\n${a.path}`;
    }
    return `⚠ Delete file\n\n${a.path}`;
  },
  spec: {
    name: 'delete_note',
    description: 'Move one existing vault file, or a folder with everything in it, to the trash configured in Obsidian. Use when the user asks to delete or clean up files. Requires user approval. The vault root and the configuration folder cannot be deleted.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative path of the file or folder to trash.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  // Refused before an approval card is shown.
  checkPermissions: async (app, args) => {
    const path = targetPath(args);
    const reason = path === null ? null : protectedVaultPath(app, path);
    return reason ? { behavior: 'deny', message: `Refusing to delete ${reason}.` } : { behavior: 'passthrough' };
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: unknown) { return `Error: ${errorMessage(e)}`; }
    const reason = protectedVaultPath(app, path);
    if (reason) return `Error: refusing to delete ${reason}.`;
    const target = app.vault.getAbstractFileByPath(path);
    if (target instanceof TFolder) {
      const count = filesInFolder(target).length;
      await app.fileManager.trashFile(target);
      return `Moved folder to trash: ${path} (${count} file${count === 1 ? '' : 's'} inside)`;
    }
    if (!(target instanceof TFile)) return `Error: not found: ${path}`;
    await app.fileManager.trashFile(target);
    return `Moved to trash: ${path}`;
  },
});
