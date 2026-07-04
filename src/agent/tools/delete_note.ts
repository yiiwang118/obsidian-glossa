/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

export const deleteNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'trash note file destructively',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `DELETE ${a.path}`,
  preview: async (a) => `⚠ Delete file\n\n${a.path}`,
  spec: {
    name: 'delete_note',
    description: 'Delete a note. DESTRUCTIVE — moves to trash. REQUIRES USER APPROVAL.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    await app.fileManager.trashFile(f);
    return `Moved to trash: ${path}`;
  },
});
