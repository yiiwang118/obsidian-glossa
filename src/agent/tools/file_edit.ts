/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { TFile } from 'obsidian';
import { findWithQuoteNormalization, assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';

/** Upstream Claude Code's FileEdit shape: {file_path, old_string, new_string, replace_all}.
 *  Empty old_string + non-empty new_string = create new file. */
export const fileEdit: ToolImpl = buildTool({
  describe: a => `edit ${a.file_path}${a.replace_all ? ' (all)' : ''}`,
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'exact string replace inside a note',
  // Normalize file_path on the observable copy so deny / allow rules can't
  // be bypassed by passing `./X` vs `X`. The actual `run()` path goes
  // through `assertVaultPath()` which does the same normalization.
  backfillObservableInput: normalizePathFields(['file_path']),
  preview: async (app, a: any) => {
    if (!a.file_path) return '(missing file_path)';
    const f = app.vault.getAbstractFileByPath(a.file_path);
    if (a.old_string === '') {
      return f instanceof TFile
        ? `⚠ ${a.file_path} already exists — file_edit with empty old_string is for NEW files only.`
        : `Create ${a.file_path}\n\n${(a.new_string ?? '').slice(0, 400)}`;
    }
    if (!(f instanceof TFile)) return `(file not found: ${a.file_path})`;
    const text = await app.vault.read(f);
    const located = findWithQuoteNormalization(text, a.old_string ?? '');
    if (!located) return `File: ${a.file_path}\n\n✗ old_string NOT FOUND in file.\n\n  - ${(a.old_string ?? '').slice(0, 200)}`;
    const occ = text.split(located).length - 1;
    if (occ > 1 && !a.replace_all) return `File: ${a.file_path}\n\n✗ old_string matches ${occ} places — pass replace_all:true or provide more context.\n\n  - ${(a.old_string ?? '').slice(0, 200)}`;
    return `File: ${a.file_path}${a.replace_all ? ` (×${occ})` : ''}\n\n  - ${(a.old_string ?? '').slice(0, 200)}\n  + ${(a.new_string ?? '').slice(0, 200)}`;
  },
  spec: {
    name: 'file_edit',
    description: [
      'Perform exact string replacement in a single note. Upstream Claude Code shape.',
      '',
      'Args:',
      '- file_path: vault-relative path',
      '- old_string: exact text to replace. Pass an empty string to CREATE a new file (new_string becomes the contents).',
      '- new_string: replacement text. Must differ from old_string.',
      '- replace_all (optional): when true, replace EVERY occurrence; otherwise old_string must match exactly once.',
      '',
      'For multi-hunk or multi-file edits prefer `apply_patch` (envelope mode). REQUIRES USER APPROVAL.'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        file_path:   { type: 'string', description: 'Vault-relative path.' },
        old_string:  { type: 'string', description: 'Exact text to find. Empty string = create new file.' },
        new_string:  { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Default false. When true, replace every occurrence.' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  run: async (app, args) => {
    const { old_string, new_string, replace_all } = args;
    let file_path: string;
    try { file_path = assertVaultPath(args.file_path, 'file_path'); }
    catch (e: any) { return `Error: ${e.message}`; }
    if (typeof new_string !== 'string') return 'Error: new_string must be a string.';
    if (typeof old_string !== 'string') return 'Error: old_string must be a string.';
    if (old_string === new_string) return 'Error: old_string and new_string are identical.';

    if (old_string === '') {
      const existing = app.vault.getAbstractFileByPath(file_path);
      if (existing instanceof TFile) return `Error: ${file_path} already exists — use a non-empty old_string to edit, or write_note to overwrite.`;
      const folder = vaultFolderOf(file_path);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
      await app.vault.create(file_path, new_string);
      return `Created ${file_path} (${new_string.length} chars).`;
    }

    const f = app.vault.getAbstractFileByPath(file_path);
    if (!(f instanceof TFile)) return `Error: file not found: ${file_path}`;
    const text = await app.vault.read(f);
    const located = findWithQuoteNormalization(text, old_string);
    if (!located) return `Error: old_string not found in ${file_path}.`;
    const occ = text.split(located).length - 1;
    if (occ === 0) return `Error: old_string not found in ${file_path}.`;
    if (occ > 1 && !replace_all) return `Error: old_string matches ${occ} places — pass replace_all:true or provide more unique context.`;
    const next = replace_all ? text.split(located).join(new_string) : text.replace(located, new_string);
    await app.vault.modify(f, next);
    return replace_all
      ? `Edited ${file_path} — replaced ${occ} occurrence${occ === 1 ? '' : 's'}.`
      : `Edited ${file_path}.`;
  },
});
