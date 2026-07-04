/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
  searchHint: 'note frontmatter get set delete list',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => {
    const op = a.op ?? 'get';
    const key = a.key ? `.${a.key}` : '';
    return `frontmatter ${op}${key} in ${a.path}`;
  },
  spec: {
    name: 'manage_frontmatter',
    description: 'Atomic CRUD on a note\'s YAML frontmatter. Use this instead of read+write_note when only adjusting a single property.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative note path.' },
        op: { type: 'string', enum: ['get', 'set', 'delete', 'list'] },
        key: { type: 'string', description: 'Frontmatter property name. Required for get/set/delete; omitted for list.' },
        value: { type: 'string', description: 'New value for set op. Parsed as JSON when possible (true/false, numbers, [arrays], {objects}); otherwise stored as a string.' },
      },
      required: ['path', 'op'],
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
    catch (e: any) { return `Error: ${e.message}`; }
    const op = args.op as 'get' | 'set' | 'delete' | 'list';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;

    let result = '';
    try {
      await app.fileManager.processFrontMatter(f, (fm: Record<string, any>) => {
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
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
    return result;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
