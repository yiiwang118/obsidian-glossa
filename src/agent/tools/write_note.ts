import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

export const writeNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'overwrite entire note content',
  searchTags: ['replace whole file', 'full rewrite', '覆盖全文', '重写笔记'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `write ${a.path}`,
  preview: async (a) => `Replace entire content of\n\n${a.path}\n\n→ ${(a.content ?? '').length} chars`,
  spec: {
    name: 'write_note',
    description: 'Replace every character of one existing note. Use only for an intentional full rewrite; use file_edit, patch_note, or apply_patch for partial changes. The file must already exist. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path of an existing file.' },
        content: { type: 'string', description: 'Complete replacement content, including frontmatter and final newline if desired.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const content = typeof args.content === 'string' ? args.content : '';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: file does not exist: ${path}. Use create_note to make a new one.`;
    await app.vault.modify(f, content);
    return `Wrote ${path} (${content.length} chars).`;
  },
});
