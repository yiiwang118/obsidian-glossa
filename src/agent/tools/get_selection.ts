
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
    description: 'Return text the user explicitly selected in file content or Glossa output. Use only when the request refers to a selection; the open file is provided separately as current context. Returns "" when nothing relevant is selected.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (app) => {
    const sel = getCurrentSelection(app);
    if (!sel || !sel.text) return '';
    const cap = 50_000;
    const text = sel.text.length > cap ? `${sel.text.slice(0, cap)}\n\n[selection truncated at ${cap} chars]` : sel.text;
    return `Source: ${sel.source}${sel.file ? `, ${sel.file.path}` : ''}\n\n${text}`;
  },
});
