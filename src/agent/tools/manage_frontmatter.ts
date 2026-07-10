/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * manage_frontmatter — atomic CRUD over a single note's YAML properties.
 *
 * Uses Obsidian's `fileManager.processFrontMatter()` which guarantees:
 *   - Other keys / comments / formatting are preserved
 *   - The YAML parse/serialize round-trip is consistent with what Obsidian's
 *     own Property editor produces
 *   - Multiple concurrent edits queue safely
 *
 * Four ops:
 *   - get    → return current value (or "(unset)")
 *   - set    → write `value` (parsed as JSON if possible, else as string)
 *   - delete → remove the key
 *   - list   → enumerate all current keys
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

export const manageFrontmatter: ToolImpl = buildTool({
  isReadOnly: a => a?.op === 'get' || a?.op === 'list',
  isDestructive: a => a?.op === 'set' || a?.op === 'delete',
  isConcurrencySafe: a => a?.op === 'get' || a?.op === 'list',
  shouldDefer: true,
  searchHint: 'note frontmatter get set delete list',
  searchTags: ['yaml property', 'metadata field', '属性', '元数据', 'frontmatter'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => {
    const op = a.op ?? 'get';
    const key = a.key ? `.${a.key}` : '';
    return `frontmatter ${op}${key} in ${a.path}`;
  },
  spec: {
    name: 'manage_frontmatter',
    description: 'Get, list, set, or delete one YAML frontmatter property through the vault property API. Prefer this over rewriting note text when only metadata changes. Set/delete operations require approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative note path.' },
        op: { type: 'string', enum: ['get', 'set', 'delete', 'list'], description: 'Operation to perform. get/list are read-only; set/delete modify the note.' },
        key: { type: 'string', description: 'Frontmatter property name. Required for get/set/delete; omitted for list.' },
        value: { type: 'string', description: 'New value for set op. Parsed as JSON when possible (true/false, numbers, [arrays], {objects}); otherwise stored as a string.' },
      },
      required: ['path', 'op'],
      additionalProperties: false,
    },
  },
  preview: async (a) => {
    const op = a.op;
    return op === 'list' ? `List frontmatter keys of ${a.path}`
         : op === 'get' ? `Get ${a.path}.${a.key}`
         : op === 'delete' ? `Delete ${a.path}.${a.key}`
         : `Set ${a.path}.${a.key} = ${(a.value ?? '').slice(0, 200)}`;
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const op = args.op as 'get' | 'set' | 'delete' | 'list';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;

    let result = '';
    try {
      await app.fileManager.processFrontMatter(f, (fm: Record<string,AnyValue>) => {
        if (op === 'list') {
          const keys = Object.keys(fm);
          result = keys.length === 0 ? '(no frontmatter)' : keys.join('\n');
          return;
        }
        if (typeof args.key !== 'string' || !args.key) {
          throw new Error('key is required for get/set/delete');
        }
        const key = args.key;
        if (op === 'get') {
          result = key in fm ? JSON.stringify(fm[key]) : '(unset)';
        } else if (op === 'delete') {
          if (key in fm) { delete fm[key]; result = `Deleted ${key}.`; }
          else result = `${key} was already unset.`;
        } else /* set */ {
          let parsed: unknown;
          try { parsed = JSON.parse(String(args.value ?? '')); }
          catch { parsed = String(args.value ?? ''); }
          fm[key] = parsed;
          result = `Set ${key} = ${JSON.stringify(parsed)}.`;
        }
      });
    } catch (e) {
      return `Error: ${e.message}`;
    }
    return result;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Re-enable review lint rules after dynamic boundary module. */
