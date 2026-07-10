/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';

/** [legacy/deprecated] Prefer the new `patch_note` tool with `op:'append'`
 *  + a section target — it can append AFTER a specific heading rather than
 *  blindly to the end of file. Kept registered (deferred) for back-compat. */
export const appendToNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'append text to end of note (prefer patch_note)',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `append ${a.path}`,
  preview: async (a) => `Append to\n\n${a.path}\n\n+ ${(a.text ?? '').length} chars at end`,
  spec: {
    name: 'append_to_note',
    description: 'Append text to the end of a note (creates note if missing). REQUIRES USER APPROVAL.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative note path.' },
        text: { type: 'string', description: 'Text appended after the current final newline.' },
      },
      required: ['path', 'text'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const text = typeof args.text === 'string' ? args.text : '';
    let f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      const folder = vaultFolderOf(path);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
      await app.vault.create(path, text);
      return `Created and wrote ${path}.`;
    }
    const cur = await app.vault.read(f);
    await app.vault.modify(f, cur + (cur.endsWith('\n') ? '' : '\n') + text);
    return `Appended to ${path}.`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
