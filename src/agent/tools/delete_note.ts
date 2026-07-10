/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

export const deleteNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'trash note file destructively',
  searchTags: ['delete file', 'remove note', '删除笔记', '移到废纸篓'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `DELETE ${a.path}`,
  preview: async (a) => `⚠ Delete file\n\n${a.path}`,
  spec: {
    name: 'delete_note',
    description: 'Move one existing vault file to the configured trash. Use only when deletion is explicitly requested. This is destructive and requires user approval.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative path of the file to trash.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    await app.fileManager.trashFile(f);
    return `Moved to trash: ${path}`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
