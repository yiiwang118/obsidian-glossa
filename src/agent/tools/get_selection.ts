/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { getCurrentSelection } from '../../context/sources';
import { buildTool, type ToolImpl } from './_shared';

export const getSelection: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'current editor text selection',
  describe: () => 'get selection',
  spec: {
    name: 'get_selection',
    description: 'Return the user\'s current text selection from file content or Glossa output. Returns "" when nothing relevant is selected.',
    parameters: { type: 'object', properties: {} },
  },
  run: async (app) => {
    const sel = getCurrentSelection(app);
    if (!sel || !sel.text) return '';
    return `Source: ${sel.source}${sel.file ? `, ${sel.file.path}` : ''}\n\n${sel.text}`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
