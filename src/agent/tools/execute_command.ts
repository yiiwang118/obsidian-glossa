/**
 * execute_command — dispatch any Obsidian command palette ID.
 *
 * The most powerful escape hatch we expose. With one tool call the model can
 * trigger Obsidian's own actions (toggle reading mode, run a plugin command,
 * open the graph view, …) — anything in Cmd+P.
 *
 * Safety: defaults to `dangerous: true` (per-call approval). Plus a blocklist
 * of inherently risky command IDs:
 *   - app:reload-app — pulls the rug out from under the agent loop
 *   - app:reset-* / app:delete-* — anything that wipes state
 *   - workspace:close-* on all-tabs — would close the AI sidebar
 * The blocklist is conservative; users can manually approve when they really
 * want it.
 *
 * Companion: `list_commands` (separate tool) discovers IDs.
 */
import { buildTool, type ToolImpl, type PermissionResult } from './_shared';

const HARD_DENY_COMMANDS = new Set<string>([
  'app:reload-app',
  'app:reset',
  'app:reset-vault',
  'app:hard-reset',
  'app:quit',
  'workspace:close-others',
  'workspace:close-window',
]);

/** Prefix patterns that are always denied — caught even when an unknown
 *  plugin registers a similar id. */
const HARD_DENY_PREFIXES = ['app:delete-', 'app:wipe-'];

function hardDenyReason(id: string): string | null {
  if (HARD_DENY_COMMANDS.has(id)) return `Command "${id}" is hard-denied (app-shutdown / vault-reset commands).`;
  for (const p of HARD_DENY_PREFIXES) {
    if (id.startsWith(p)) return `Command "${id}" hard-denied (matches "${p}*").`;
  }
  return null;
}

export const executeCommand: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,             // unknown side effects → treat as destructive
  isConcurrencySafe: () => false,
  searchHint: 'invoke obsidian command palette action',
  describe: a => `run command "${a.command_id}"`,
  spec: {
    name: 'execute_command',
    description: [
      'Dispatch an Obsidian command palette ID. Equivalent to picking it from Cmd+P.',
      'Discover available IDs via list_commands first.',
      '',
      'REQUIRES USER APPROVAL on every call. Certain IDs (app:reload-app, app:reset-*,',
      'app:delete-*, app:wipe-*, workspace:close-*) are HARD-DENIED — no override.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        command_id: { type: 'string', description: 'Exact command palette ID, e.g. "editor:toggle-source".' },
      },
      required: ['command_id'],
    },
  },
  preview: async (a) => `Dispatch Obsidian command:\n\n${a.command_id}\n\n(equivalent to picking it from Cmd+P)`,
  async checkPermissions(_app, args): Promise<PermissionResult> {
    const id = String(args?.command_id ?? '');
    if (!id) return { behavior: 'deny', message: 'command_id is required.' };
    const hardDeny = hardDenyReason(id);
    if (hardDeny) return { behavior: 'deny', message: hardDeny };
    return { behavior: 'ask', message: `Dispatch command: ${id}` };
  },
  run: async (app, args) => {
    const id = String(args?.command_id ?? '').trim();
    if (!id) return 'Error: command_id is required.';
    const hardDeny = hardDenyReason(id);
    if (hardDeny) return `Error: ${hardDeny}`;
    const cmd = (app as any).commands?.commands?.[id];
    if (!cmd) return `Error: command not found: ${id}. Use list_commands to discover valid IDs.`;
    try {
      const ok = await (app as any).commands.executeCommandById(id);
      // Some commands intentionally no-op (e.g. wrong context). Report what happened.
      if (ok === false) return `Command "${id}" was registered but its checkCallback declined (likely wrong context).`;
      return `Dispatched: ${id}${cmd.name ? `  (${cmd.name})` : ''}`;
    } catch (e: any) {
      return `Error dispatching ${id}: ${e?.message ?? e}`;
    }
  },
});
