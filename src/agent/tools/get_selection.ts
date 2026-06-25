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
