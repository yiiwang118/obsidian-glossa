/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { buildTool, type ToolImpl } from './_shared';

export const getActiveFile: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'currently open file in editor',
  describe: () => 'get active file',
  spec: {
    name: 'get_active_file',
    description: 'Return the path and full content of the file currently open in the editor.',
    parameters: { type: 'object', properties: {} },
  },
  run: async (app) => {
    const f = app.workspace.getActiveFile();
    if (!f) return 'No active file.';
    if (f.extension !== 'md') return `Active file: ${f.path} (non-markdown, content not loaded)`;
    const text = await app.vault.read(f);
    return `Path: ${f.path}\n\n---\n\n${text}`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
