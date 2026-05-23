import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

export const writeNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'overwrite entire note content',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `write ${a.path}`,
  preview: async (a) => `Replace entire content of\n\n${a.path}\n\n→ ${(a.content ?? '').length} chars`,
  spec: {
    name: 'write_note',
    description: 'Overwrite the entire content of an existing note. For partial edits use file_edit or apply_patch. REQUIRES USER APPROVAL.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    const content = typeof args.content === 'string' ? args.content : '';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: file does not exist: ${path}. Use create_note to make a new one.`;
    await app.vault.modify(f, content);
    return `Wrote ${path} (${content.length} chars).`;
  },
});
