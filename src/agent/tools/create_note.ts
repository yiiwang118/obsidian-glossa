/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';

export const createNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'create new note in vault',
  searchTags: ['new file', 'write note', '新建笔记', '创建文件'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `create ${a.path}`,
  preview: async (a) => `Create new note\n\n${a.path}\n\n→ ${(a.content ?? '').length} chars`,
  spec: {
    name: 'create_note',
    description: 'Create one new vault file and any missing parent folders. Fails rather than overwriting when the path exists. For multi-file creation use apply_patch. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path for the new file, including its extension.' },
        content: { type: 'string', description: 'Initial complete file content.' },
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
    try {
      const folder = vaultFolderOf(path);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
      await app.vault.create(path, content);
      return `Created ${path}.`;
    } catch (e) { return `Error: ${e.message}`; }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
