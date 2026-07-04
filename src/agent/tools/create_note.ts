/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';

export const createNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'create new note in vault',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `create ${a.path}`,
  preview: async (a) => `Create new note\n\n${a.path}\n\n→ ${(a.content ?? '').length} chars`,
  spec: {
    name: 'create_note',
    description: 'Create a new note with the given content. Fails if file exists. REQUIRES USER APPROVAL.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const content = typeof args.content === 'string' ? args.content : '';
    try {
      const folder = vaultFolderOf(path);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
      await app.vault.create(path, content);
      return `Created ${path}.`;
    } catch (e) { return `Error: ${e.message}`; }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
