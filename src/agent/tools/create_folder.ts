import { TFolder } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, protectedVaultPath, type ToolImpl } from './_shared';
import { bi } from '../../utils/i18n';

function rawPath(args: unknown): unknown {
  return (args as { path?: unknown } | null)?.path;
}

function folderPath(args: unknown): string | null {
  try { return assertVaultPath(rawPath(args)).replace(/\/+$/, ''); } catch { return null; }
}

export const createFolder: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'create an empty folder',
  searchTags: ['new folder', 'make directory', 'mkdir', '新建文件夹', '创建目录'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => { const raw = rawPath(a); const path = typeof raw === 'string' ? raw : ''; return bi(`create folder ${path}`, `新建文件夹 ${path}`); },
  spec: {
    name: 'create_folder',
    description: 'Create a vault folder, including missing parent folders. Notes can be created inside new folders directly; use this for an empty folder. Requires user approval.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative folder path.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  // Refused before an approval card is shown.
  checkPermissions: async (app, args) => {
    const path = folderPath(args);
    const reason = path === null ? null : protectedVaultPath(app, path);
    return reason ? { behavior: 'deny', message: `Refusing to change ${reason}.` } : { behavior: 'passthrough' };
  },
  run: async (app, args) => {
    const path = folderPath(args);
    if (path === null) return 'Error: pass a vault-relative folder path like "Projects/2026".';
    const reason = protectedVaultPath(app, path);
    if (reason) return `Error: refusing to change ${reason}.`;
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return `Folder already exists: ${path}`;
    if (existing) return `Error: a file already exists at ${path}`;
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      const node = app.vault.getAbstractFileByPath(current);
      if (node instanceof TFolder) continue;
      if (node) return `Error: ${current} is a file, not a folder`;
      await app.vault.createFolder(current);
    }
    return `Created folder: ${path}`;
  },
});
