/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
/**
 * rename_note — move or rename a note, preserving all wikilinks to it.
 *
 * Uses `app.fileManager.renameFile()` which is the Obsidian-blessed rename
 * path: it (a) physically moves/renames the file, (b) updates every wikilink
 * across the vault that pointed at the old name. A plain
 * `vault.rename` does NOT update backlinks — so we delegate to fileManager.
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';

export const renameNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'rename or move note preserving wikilinks',
  backfillObservableInput: normalizePathFields(['from', 'to']),
  describe: a => `rename ${a.from} → ${a.to}`,
  spec: {
    name: 'rename_note',
    description: 'Move / rename a note. Obsidian automatically rewrites every wikilink pointing at the old path. REQUIRES USER APPROVAL.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current vault-relative path.' },
        to:   { type: 'string', description: 'New vault-relative path.' },
      },
      required: ['from', 'to'],
    },
  },
  preview: async (a) => `Rename:\n  ${a.from}\n→ ${a.to}\n\n(wikilinks pointing at the old path will be auto-updated)`,
  run: async (app, args) => {
    let from: string, to: string;
    try {
      from = assertVaultPath(args.from, 'from');
      to = assertVaultPath(args.to, 'to');
    } catch (e: any) { return `Error: ${e.message}`; }
    if (from === to) return 'Error: from and to are identical — nothing to rename.';
    const f = app.vault.getAbstractFileByPath(from);
    if (!(f instanceof TFile)) return `Error: source not found: ${from}`;
    if (app.vault.getAbstractFileByPath(to)) return `Error: destination already exists: ${to}`;
    try {
      const folder = vaultFolderOf(to);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
      await app.fileManager.renameFile(f, to);
      return `Renamed ${from} → ${to} (backlinks auto-updated).`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});
