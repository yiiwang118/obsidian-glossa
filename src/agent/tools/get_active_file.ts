
import { buildTool, type ToolImpl } from './_shared';

export const getActiveFile: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'currently open file in editor',
  describe: () => 'get active file',
  spec: {
    name: 'get_active_file',
    description: 'Return the active file path and a bounded Markdown body. Use only when the active target is ambiguous or current-file context is absent; do not use as a substitute for an explicitly named file.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (app) => {
    const f = app.workspace.getActiveFile();
    if (!f) return 'No active file.';
    if (f.extension !== 'md') return `Active file: ${f.path} (non-markdown, content not loaded)`;
    const text = await app.vault.read(f);
    const cap = 50_000;
    const body = text.length > cap ? `${text.slice(0, cap)}\n\n[truncated at ${cap} of ${text.length} chars]` : text;
    return `Path: ${f.path}\n\n---\n\n${body}`;
  },
});
