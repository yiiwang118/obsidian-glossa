import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

/** Legacy single-shot edit tool. Prefer `file_edit` for new code — kept here so the
 *  model can still find it if it learned to call it. Marked `shouldDefer` to keep
 *  it out of the default tool surface (model can still reach it via tool_search). */
export const editSection: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'legacy find-replace edit (use file_edit instead)',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `edit ${a.path}`,
  preview: async (app, a: any) => {
    const f = app.vault.getAbstractFileByPath(a.path);
    if (!(f instanceof TFile)) return `(file not found: ${a.path})`;
    const text = await app.vault.read(f);
    const found = text.includes(a.find);
    return `File: ${a.path}\n\nFind ${found ? '✓' : '✗ NOT MATCHED'}:\n  ${a.find.slice(0, 200)}\n\nReplace with:\n  ${a.replace.slice(0, 200)}`;
  },
  spec: {
    name: 'edit_section',
    description: 'Replace an exact text snippet inside a note. The "find" string must appear verbatim. REQUIRES USER APPROVAL. (Legacy — prefer file_edit.)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        find: { type: 'string', description: 'Exact text to locate. Include enough context to be unique.' },
        replace: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'find', 'replace'],
    },
  },
  run: async (app, args) => {
    const { find, replace } = args;
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    if (typeof find !== 'string' || find.length === 0) return 'Error: "find" must be a non-empty string.';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    const text = await app.vault.read(f);
    if (!text.includes(find)) return `Error: "find" string not found in ${path}.`;
    const occurrences = text.split(find).length - 1;
    if (occurrences > 1) return `Error: "find" matches ${occurrences} places — please supply more unique context.`;
    const next = text.replace(find, replace ?? '');
    await app.vault.modify(f, next);
    return `Edited ${path}.`;
  },
});
