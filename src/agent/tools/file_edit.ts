/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import {
  applyTextEdits,
  describeTextMatches,
  textFingerprint,
  type TextEditOperation,
} from '../text_edit_engine';
import { assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';

function operationsFromArgs(args: AnyValue): { operations?: TextEditOperation[]; error?: string } {
  const raw = Array.isArray(args.edits)
    ? args.edits
    : [{ old_string: args.old_string, new_string: args.new_string, replace_all: args.replace_all }];
  if (raw.length === 0) return { error: 'edits must not be empty.' };
  const operations: TextEditOperation[] = [];
  for (let i = 0; i < raw.length; i++) {
    const edit = raw[i];
    if (typeof edit?.old_string !== 'string') return { error: `edit ${i + 1}: old_string must be a string.` };
    if (typeof edit?.new_string !== 'string') return { error: `edit ${i + 1}: new_string must be a string.` };
    operations.push({ oldText: edit.old_string, newText: edit.new_string, replaceAll: edit.replace_all === true });
  }
  return { operations };
}

/** Upstream Claude Code's FileEdit shape plus a batched form used internally
 *  when one assistant turn emits several edits for the same file. */
export const fileEdit: ToolImpl = buildTool({
  describe: a => `edit ${a.file_path}${Array.isArray(a.edits) ? ` (${a.edits.length} edits)` : (a.replace_all ? ' (all)' : '')}`,
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'safe exact or normalized string replacements inside one note',
  backfillObservableInput: normalizePathFields(['file_path']),
  preview: async (app, a: AnyValue) => {
    let filePath: string;
    try { filePath = assertVaultPath(a.file_path, 'file_path'); }
    catch (e) { return `Error: ${e.message}`; }
    const parsed = operationsFromArgs(a);
    if (!parsed.operations) return `Error: ${parsed.error}`;
    const operations = parsed.operations;
    const create = operations.length === 1 && operations[0].oldText === '';
    const f = app.vault.getAbstractFileByPath(filePath);
    if (create) {
      return f instanceof TFile
        ? `⚠ ${filePath} already exists — empty old_string is for new files only.`
        : `Create ${filePath}\n\n${operations[0].newText.slice(0, 400)}`;
    }
    if (operations.some(operation => operation.oldText === '')) return 'Error: empty old_string is only valid for a single create operation.';
    if (!(f instanceof TFile)) return `(file not found: ${filePath})`;
    const text = await app.vault.read(f);
    const result = applyTextEdits(text, operations);
    if (result.ok === false) return `File: ${filePath}\n\n✗ edit ${(result.operationIndex ?? 0) + 1}: ${result.error}`;
    a.__expectedFingerprint = result.fingerprint;
    return [
      `File: ${filePath}`,
      `Match: ${describeTextMatches(result.edits)}`,
      '',
      ...operations.flatMap((operation, index) => [
        `Edit ${index + 1}:`,
        `  - ${operation.oldText.slice(0, 200)}`,
        `  + ${operation.newText.slice(0, 200)}`,
      ]),
    ].join('\n');
  },
  spec: {
    name: 'file_edit',
    description: 'Safely replace text in one file. Matching is exact, then Unicode/punctuation normalized, with unique high-confidence fuzzy matching only as a disclosed last resort. Ambiguous edits fail without writing; an empty old_string creates without overwriting. Sibling edits to one file are batched automatically. Requires approval.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Vault-relative path.' },
        old_string: { type: 'string', description: 'Single-edit search text. Empty string creates a new file.' },
        new_string: { type: 'string', description: 'Single-edit replacement text.' },
        replace_all: { type: 'boolean', description: 'Single-edit mode only. Replace every safely matched occurrence.' },
      },
      required: ['file_path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    let filePath: string;
    try { filePath = assertVaultPath(args.file_path, 'file_path'); }
    catch (e) { return `Error: ${e.message}`; }
    const parsed = operationsFromArgs(args);
    if (!parsed.operations) return `Error: ${parsed.error}`;
    const operations = parsed.operations;

    if (operations.length === 1 && operations[0].oldText === '') {
      const existing = app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof TFile) return `Error: ${filePath} already exists — use a non-empty old_string to edit, or write_note to overwrite.`;
      const folder = vaultFolderOf(filePath);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* already exists */ }
      await app.vault.create(filePath, operations[0].newText);
      return `Created ${filePath} (${operations[0].newText.length} chars).`;
    }
    if (operations.some(operation => operation.oldText === '')) return 'Error: empty old_string is only valid for a single create operation.';

    const f = app.vault.getAbstractFileByPath(filePath);
    if (!(f instanceof TFile)) return `Error: file not found: ${filePath}`;
    const text = await app.vault.read(f);
    const expected = typeof args.__expectedFingerprint === 'string' ? args.__expectedFingerprint : '';
    if (expected && textFingerprint(text) !== expected) {
      return `Error: ${filePath} changed after preview; no changes were applied. Re-read the file and retry.`;
    }
    const result = applyTextEdits(text, operations);
    if (result.ok === false) return `Error: edit ${(result.operationIndex ?? 0) + 1}: ${result.error}`;
    await app.vault.modify(f, result.content);
    return `Edited ${filePath} once with ${operations.length} edit${operations.length === 1 ? '' : 's'} (${describeTextMatches(result.edits)}).`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
