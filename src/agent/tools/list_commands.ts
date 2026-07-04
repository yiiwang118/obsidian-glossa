/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
/**
 * list_commands — enumerate Obsidian command palette IDs available right now.
 *
 * Companion to `execute_command`. Returns ID + human-readable name. The IDs
 * change based on which plugins are enabled, so the model should call this
 * just before `execute_command` to see what's actually reachable.
 */
import { buildTool, type ToolImpl } from './_shared';

export const listCommands: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  dangerous: false,
  searchHint: 'enumerate obsidian command palette ids',
  describe: a => a?.filter ? `list commands like "${a.filter}"` : 'list commands',
  spec: {
    name: 'list_commands',
    description: 'List available Obsidian command palette commands. Optionally filter by substring (case-insensitive, matched against both id and name).',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional substring; matches id OR display name.' },
        max_results: { type: 'number', description: 'Default 100.' },
      },
    },
  },
  run: async (app, args) => {
    const filter = String(args?.filter ?? '').toLowerCase().trim();
    const max = Math.max(1, Math.min(2000, Number(args?.max_results) || 100));
    const commands = (app as any).commands?.commands ?? {};
    const entries: { id: string; name: string }[] = [];
    for (const id of Object.keys(commands)) {
      const c = commands[id];
      const name = String(c?.name ?? '');
      if (filter) {
        if (!id.toLowerCase().includes(filter) && !name.toLowerCase().includes(filter)) continue;
      }
      entries.push({ id, name });
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    const total = entries.length;
    const shown = entries.slice(0, max);
    if (shown.length === 0) return filter ? `No commands matching "${filter}".` : '(no commands registered)';
    const tail = total > shown.length ? `\n\n[+${total - shown.length} more — narrow the filter or raise max_results]` : '';
    return `${total} command${total === 1 ? '' : 's'}${filter ? ` matching "${filter}"` : ''}:\n\n${
      shown.map(e => `${e.id}  —  ${e.name}`).join('\n')
    }${tail}`;
  },
});
